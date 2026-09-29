<?php
declare(strict_types=1);

// Fehler nie als HTML ausgeben – das Frontend erwartet immer JSON.
ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

set_error_handler(function (int $severity, string $message, string $file, int $line): bool {
    if (!(error_reporting() & $severity) || ($severity & (E_DEPRECATED | E_USER_DEPRECATED))) {
        return false;
    }
    throw new ErrorException($message, 0, $severity, $file, $line);
});

set_exception_handler(function (Throwable $e): void {
    error_log('[lootroll] ' . $e);
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }
    echo json_encode(['error' => 'Serverfehler: ' . $e->getMessage()], JSON_UNESCAPED_UNICODE);
});

require __DIR__ . '/lib/db.php';
require __DIR__ . '/lib/components.php';

// main = Priorität, twink = Gier (interne Schlüssel bleiben für bestehende Daten gleich).
const ROLL_MAX = ['main' => 100, 'twink' => 50];
const ROLL_KINDS = ['main', 'twink', 'pass'];
const MAX_DEADLINE_DAYS = 365;

/** @return no-return */
function respond(array $data, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

/** @return no-return */
function fail(string $message, int $status = 400): void
{
    respond(['error' => $message], $status);
}

// mbstring ist nicht auf jedem Webspace installiert – daher mit Fallback.
function str_cut(string $value, int $max): string
{
    if (function_exists('mb_substr')) {
        return mb_substr($value, 0, $max, 'UTF-8');
    }
    return preg_match('/^.{0,' . $max . '}/us', $value, $m) ? $m[0] : substr($value, 0, $max);
}

function str_lower(string $value): string
{
    return function_exists('mb_strtolower') ? mb_strtolower($value, 'UTF-8') : strtolower($value);
}

function clean_text($value, int $max): string
{
    $value = is_string($value) ? trim(preg_replace('/\s+/u', ' ', $value) ?? '') : '';
    return str_cut($value, $max);
}

function current_user(): string
{
    $user = clean_text($_COOKIE['loot_user'] ?? '', 32);
    if ($user === '') {
        fail('Bitte zuerst einen Namen angeben.', 401);
    }
    return $user;
}

function parse_deadline($value): int
{
    if (!is_numeric($value)) {
        fail('Bitte eine Deadline angeben.');
    }
    $deadline = (int)$value;
    if ($deadline <= time()) {
        fail('Die Deadline muss in der Zukunft liegen.');
    }
    if ($deadline > time() + MAX_DEADLINE_DAYS * 86400) {
        fail('Die Deadline darf höchstens ein Jahr in der Zukunft liegen.');
    }
    return $deadline;
}

function find_list(int $id): array
{
    $stmt = db()->prepare('SELECT * FROM lists WHERE id = ?');
    $stmt->execute([$id]);
    $list = $stmt->fetch();
    if (!$list) {
        fail('Lootliste nicht gefunden.', 404);
    }
    return $list;
}

function find_item_list(int $itemId): array
{
    $stmt = db()->prepare('SELECT list_id, done FROM items WHERE id = ?');
    $stmt->execute([$itemId]);
    $row = $stmt->fetch();
    if (!$row) {
        fail('Item nicht gefunden.', 404);
    }
    return [find_list((int)$row['list_id']), (bool)$row['done']];
}

function require_owner(array $list, string $user): void
{
    if (str_lower($list['created_by']) !== str_lower($user)) {
        fail('Nur der Ersteller der Liste darf das.', 403);
    }
}

function require_not_archived(array $list): void
{
    if ((int)$list['archived'] === 1) {
        fail('Die Liste ist archiviert und kann nicht mehr verändert werden.');
    }
}

/** draft | open | expired | closed – "expired" = offen, aber Deadline erreicht. */
function list_phase(array $list): string
{
    if ($list['status'] === 'open' && $list['deadline'] !== null && (int)$list['deadline'] <= time()) {
        return 'expired';
    }
    return $list['status'];
}

/** Priorität schlägt Gier, danach höchster Wert. "Kein Interesse" zählt nicht. Gibt Gewinner-Namen (mehrere bei Gleichstand) zurück. */
function winners(array $rolls): array
{
    $rolls = array_filter($rolls, function ($r) { return $r['kind'] !== 'pass'; });
    if (!$rolls) {
        return [];
    }
    $pool = array_filter($rolls, function ($r) { return $r['kind'] === 'main'; }) ?: $rolls;
    $best = max(array_column($pool, 'value'));
    return array_values(array_map(
        function ($r) { return $r['username']; },
        array_filter($pool, function ($r) use ($best) { return $r['value'] === $best; })
    ));
}

function normalize_list(array $list): array
{
    $list['id'] = (int)$list['id'];
    $list['created_at'] = (int)$list['created_at'];
    $list['deadline'] = $list['deadline'] === null ? null : (int)$list['deadline'];
    $list['archived'] = (int)$list['archived'] === 1;
    $list['phase'] = list_phase($list);
    return $list;
}

function list_detail(int $id): array
{
    $list = normalize_list(find_list($id));

    $stmt = db()->prepare('SELECT * FROM items WHERE list_id = ? ORDER BY id DESC');
    $stmt->execute([$id]);
    $items = $stmt->fetchAll();

    $stmt = db()->prepare(
        'SELECT r.id, r.item_id, r.username, r.kind, r.value, r.created_at
         FROM rolls r JOIN items i ON i.id = r.item_id
         WHERE i.list_id = ?
         ORDER BY CASE r.kind WHEN \'main\' THEN 0 WHEN \'twink\' THEN 1 ELSE 2 END, r.value DESC, r.created_at ASC'
    );
    $stmt->execute([$id]);
    $byItem = [];
    foreach ($stmt->fetchAll() as $roll) {
        $roll['value'] = $roll['value'] === null ? null : (int)$roll['value'];
        $byItem[$roll['item_id']][] = $roll;
    }

    foreach ($items as &$item) {
        $item['id'] = (int)$item['id'];
        $item['quality'] = $item['quality'] === null ? null : (int)$item['quality'];
        $item['done'] = (int)$item['done'] === 1;
        $item['rolls'] = $byItem[$item['id']] ?? [];
        $item['winners'] = winners($item['rolls']);
    }
    unset($item);

    $list['items'] = $items;
    $list['server_time'] = time();
    return $list;
}

function health(): array
{
    $checks = [
        'php_version' => PHP_VERSION,
        'php_ok' => version_compare(PHP_VERSION, '7.4.0', '>='),
        'pdo_sqlite' => extension_loaded('pdo_sqlite'),
        'mbstring' => extension_loaded('mbstring'),
        'data_dir_writable' => is_dir(DATA_DIR) && is_writable(DATA_DIR),
        'db_write' => false,
    ];
    try {
        $pdo = db();
        $pdo->beginTransaction();
        $pdo->exec('CREATE TABLE IF NOT EXISTS _health (t INTEGER)');
        $pdo->exec('INSERT INTO _health VALUES (1)');
        $pdo->rollBack();
        $checks['db_write'] = true;
    } catch (Throwable $e) {
        $checks['db_error'] = $e->getMessage();
    }
    $checks['ok'] = $checks['php_ok'] && $checks['pdo_sqlite'] && $checks['db_write'];
    return $checks;
}

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    switch ($action) {
        case 'health':
            respond(health());

        case 'components':
            respond(['components' => COMPONENT_TYPES, 'classes' => COMPONENT_CLASSES]);

        case 'lists':
            $rows = db()->query(
                'SELECT l.*,
                        (SELECT COUNT(*) FROM items i WHERE i.list_id = l.id) AS item_count,
                        (SELECT COUNT(*) FROM items i WHERE i.list_id = l.id AND i.done = 1) AS done_count
                 FROM lists l
                 ORDER BY CASE l.status WHEN \'open\' THEN 0 WHEN \'draft\' THEN 1 ELSE 2 END, l.created_at DESC'
            )->fetchAll();
            foreach ($rows as &$row) {
                $row = normalize_list($row);
                $row['item_count'] = (int)$row['item_count'];
                $row['done_count'] = (int)$row['done_count'];
            }
            unset($row);
            respond(['lists' => $rows, 'server_time' => time()]);

        case 'list':
            respond(['list' => list_detail((int)($_GET['id'] ?? 0))]);
    }
    fail('Unbekannte Aktion.', 404);
}

if ($method !== 'POST') {
    fail('Methode nicht erlaubt.', 405);
}

// Nur JSON-Requests akzeptieren (schützt vor einfachen Cross-Site-Formularen).
if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') === false) {
    fail('JSON erwartet.', 415);
}
$input = json_decode(file_get_contents('php://input') ?: '', true);
if (!is_array($input)) {
    fail('Ungültige Anfrage.');
}

$user = current_user();
$now = time();
$pdo = db();

switch ($action) {
    case 'create_list':
        $title = clean_text($input['title'] ?? '', 80);
        if ($title === '') {
            fail('Bitte einen Titel angeben.');
        }
        $deadline = parse_deadline($input['deadline'] ?? null);
        $pdo->prepare('INSERT INTO lists (title, created_by, status, created_at, deadline) VALUES (?, ?, \'draft\', ?, ?)')
            ->execute([$title, $user, $now, $deadline]);
        respond(['id' => (int)$pdo->lastInsertId()]);

    case 'delete_list':
        $list = find_list((int)($input['list_id'] ?? 0));
        require_owner($list, $user);
        $pdo->prepare('DELETE FROM lists WHERE id = ?')->execute([$list['id']]);
        respond(['ok' => true]);

    case 'archive':
        $list = find_list((int)($input['list_id'] ?? 0));
        require_owner($list, $user);
        $pdo->prepare('UPDATE lists SET archived = ? WHERE id = ?')
            ->execute([empty($input['archived']) ? 0 : 1, $list['id']]);
        respond(['list' => list_detail((int)$list['id'])]);

    case 'set_deadline':
        $list = find_list((int)($input['list_id'] ?? 0));
        require_owner($list, $user);
        require_not_archived($list);
        if ($list['status'] === 'closed') {
            fail('Die Verteilung ist bereits abgeschlossen.');
        }
        $pdo->prepare('UPDATE lists SET deadline = ? WHERE id = ?')
            ->execute([parse_deadline($input['deadline'] ?? null), $list['id']]);
        respond(['list' => list_detail((int)$list['id'])]);

    case 'add_item':
        $list = find_list((int)($input['list_id'] ?? 0));
        require_owner($list, $user);
        require_not_archived($list);
        if ($list['status'] !== 'draft') {
            fail('Die Liste ist bereits freigegeben.');
        }
        $name = clean_text($input['name'] ?? '', 100);
        if ($name === '') {
            fail('Der Name ist ein Pflichtfeld.');
        }
        $type = $input['type'] ?? null;
        $quality = null;
        $componentType = null;
        $componentClass = null;
        if ($type === 'ore') {
            $q = $input['quality'] ?? null;
            if ($q !== null && $q !== '') {
                if (!is_numeric($q) || (int)$q < 0 || (int)$q > 1000) {
                    fail('Qualität muss zwischen 0 und 1000 liegen.');
                }
                $quality = (int)$q;
            }
        } elseif ($type === 'component') {
            $ct = clean_text($input['component_type'] ?? '', 60);
            if ($ct !== '') {
                if (!component_type_valid($ct)) {
                    fail('Unbekannter Komponenten-Typ.');
                }
                $componentType = $ct;
            }
            $cc = $input['component_class'] ?? null;
            if ($cc !== null && $cc !== '') {
                if (!is_string($cc) || !in_array($cc, COMPONENT_CLASSES, true)) {
                    fail('Ungültige Class – erlaubt sind A, B, C und D.');
                }
                $componentClass = $cc;
            }
        } else {
            $type = null;
        }
        $pdo->prepare('INSERT INTO items (list_id, name, type, quality, component_type, component_class, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            ->execute([$list['id'], $name, $type, $quality, $componentType, $componentClass, $now]);
        respond(['list' => list_detail((int)$list['id'])]);

    case 'delete_item':
        [$list] = find_item_list((int)($input['item_id'] ?? 0));
        require_owner($list, $user);
        require_not_archived($list);
        if ($list['status'] !== 'draft') {
            fail('Die Liste ist bereits freigegeben.');
        }
        $pdo->prepare('DELETE FROM items WHERE id = ?')->execute([(int)$input['item_id']]);
        respond(['list' => list_detail((int)$list['id'])]);

    case 'toggle_done':
        [$list, $done] = find_item_list((int)($input['item_id'] ?? 0));
        require_owner($list, $user);
        require_not_archived($list);
        if ($list['status'] === 'draft') {
            fail('Items können erst nach der Freigabe als erledigt markiert werden.');
        }
        $pdo->prepare('UPDATE items SET done = ? WHERE id = ?')
            ->execute([$done ? 0 : 1, (int)$input['item_id']]);
        respond(['list' => list_detail((int)$list['id'])]);

    case 'publish':
        $list = find_list((int)($input['list_id'] ?? 0));
        require_owner($list, $user);
        require_not_archived($list);
        if ($list['status'] !== 'draft') {
            fail('Die Liste ist bereits freigegeben.');
        }
        if ($list['deadline'] === null || (int)$list['deadline'] <= $now) {
            fail('Bitte zuerst eine Deadline in der Zukunft setzen.');
        }
        $count = $pdo->prepare('SELECT COUNT(*) FROM items WHERE list_id = ?');
        $count->execute([$list['id']]);
        if ((int)$count->fetchColumn() === 0) {
            fail('Die Liste enthält noch keine Items.');
        }
        $pdo->prepare('UPDATE lists SET status = \'open\' WHERE id = ?')->execute([$list['id']]);
        respond(['list' => list_detail((int)$list['id'])]);

    case 'close':
        $list = find_list((int)($input['list_id'] ?? 0));
        require_owner($list, $user);
        require_not_archived($list);
        if ($list['status'] !== 'open') {
            fail('Nur offene Listen können abgeschlossen werden.');
        }
        $pdo->prepare('UPDATE lists SET status = \'closed\' WHERE id = ?')->execute([$list['id']]);
        respond(['list' => list_detail((int)$list['id'])]);

    case 'roll':
        $kind = $input['kind'] ?? '';
        if (!is_string($kind) || !in_array($kind, ROLL_KINDS, true)) {
            fail('Ungültige Wurfart.');
        }
        [$list, $done] = find_item_list((int)($input['item_id'] ?? 0));
        require_not_archived($list);
        $phase = list_phase($list);
        if ($phase === 'expired') {
            fail('Die Deadline ist abgelaufen – es kann nicht mehr gewürfelt werden.');
        }
        if ($phase !== 'open') {
            fail('Auf diese Liste kann nicht (mehr) gewürfelt werden.');
        }
        if ($done) {
            fail('Dieses Item ist bereits erledigt.');
        }
        try {
            $pdo->prepare('INSERT INTO rolls (item_id, username, kind, value, created_at) VALUES (?, ?, ?, ?, ?)')
                ->execute([(int)$input['item_id'], $user, $kind, $kind === 'pass' ? null : random_int(0, ROLL_MAX[$kind]), $now]);
        } catch (PDOException $e) {
            if (strpos($e->getMessage(), 'UNIQUE') !== false) {
                fail('Du hast für dieses Item bereits entschieden.', 409);
            }
            throw $e;
        }
        respond(['list' => list_detail((int)$list['id'])]);

    case 'unpass':
        // "Kein Interesse" zurücknehmen, solange noch gewürfelt werden kann.
        [$list, $done] = find_item_list((int)($input['item_id'] ?? 0));
        require_not_archived($list);
        if (list_phase($list) !== 'open' || $done) {
            fail('Die Entscheidung kann nicht mehr geändert werden.');
        }
        $pdo->prepare('DELETE FROM rolls WHERE item_id = ? AND username = ? AND kind = \'pass\'')
            ->execute([(int)$input['item_id'], $user]);
        respond(['list' => list_detail((int)$list['id'])]);
}

fail('Unbekannte Aktion.', 404);
