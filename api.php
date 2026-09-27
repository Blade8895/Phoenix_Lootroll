<?php
declare(strict_types=1);

require __DIR__ . '/lib/db.php';
require __DIR__ . '/lib/components.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

const ROLL_MAX = ['main' => 100, 'twink' => 50];

function respond(array $data, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(string $message, int $status = 400): never
{
    respond(['error' => $message], $status);
}

function clean_text(mixed $value, int $max): string
{
    $value = is_string($value) ? trim(preg_replace('/\s+/u', ' ', $value) ?? '') : '';
    return mb_substr($value, 0, $max);
}

function current_user(): string
{
    $user = clean_text($_COOKIE['loot_user'] ?? '', 32);
    if ($user === '') {
        fail('Bitte zuerst einen Namen angeben.', 401);
    }
    return $user;
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

function require_owner(array $list, string $user): void
{
    if (mb_strtolower($list['created_by']) !== mb_strtolower($user)) {
        fail('Nur der Ersteller der Liste darf das.', 403);
    }
}

/** Main schlägt Twink, danach höchster Wert. Gibt Gewinner-Namen (mehrere bei Gleichstand) zurück. */
function winners(array $rolls): array
{
    if (!$rolls) {
        return [];
    }
    $pool = array_filter($rolls, fn($r) => $r['kind'] === 'main') ?: $rolls;
    $best = max(array_column($pool, 'value'));
    return array_values(array_map(
        fn($r) => $r['username'],
        array_filter($pool, fn($r) => $r['value'] === $best)
    ));
}

function list_detail(int $id): array
{
    $list = find_list($id);

    $stmt = db()->prepare('SELECT * FROM items WHERE list_id = ? ORDER BY id');
    $stmt->execute([$id]);
    $items = $stmt->fetchAll();

    $stmt = db()->prepare(
        'SELECT r.id, r.item_id, r.username, r.kind, r.value, r.created_at
         FROM rolls r JOIN items i ON i.id = r.item_id
         WHERE i.list_id = ?
         ORDER BY (r.kind = \'main\') DESC, r.value DESC, r.created_at ASC'
    );
    $stmt->execute([$id]);
    $byItem = [];
    foreach ($stmt->fetchAll() as $roll) {
        $roll['value'] = (int)$roll['value'];
        $byItem[$roll['item_id']][] = $roll;
    }

    foreach ($items as &$item) {
        $item['id'] = (int)$item['id'];
        $item['quality'] = $item['quality'] === null ? null : (int)$item['quality'];
        $item['rolls'] = $byItem[$item['id']] ?? [];
        $item['winners'] = winners($item['rolls']);
    }
    unset($item);

    $list['id'] = (int)$list['id'];
    $list['items'] = $items;
    return $list;
}

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    switch ($action) {
        case 'components':
            respond(['components' => COMPONENT_TYPES]);

        case 'lists':
            $rows = db()->query(
                'SELECT l.id, l.title, l.created_by, l.status, l.created_at,
                        (SELECT COUNT(*) FROM items i WHERE i.list_id = l.id) AS item_count
                 FROM lists l
                 ORDER BY CASE l.status WHEN \'open\' THEN 0 WHEN \'draft\' THEN 1 ELSE 2 END, l.created_at DESC'
            )->fetchAll();
            foreach ($rows as &$row) {
                $row['id'] = (int)$row['id'];
                $row['item_count'] = (int)$row['item_count'];
            }
            respond(['lists' => $rows]);

        case 'list':
            respond(['list' => list_detail((int)($_GET['id'] ?? 0))]);
    }
    fail('Unbekannte Aktion.', 404);
}

if ($method !== 'POST') {
    fail('Methode nicht erlaubt.', 405);
}

// Nur JSON-Requests akzeptieren (schützt vor einfachen Cross-Site-Formularen).
if (!str_starts_with($_SERVER['CONTENT_TYPE'] ?? '', 'application/json')) {
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
        $pdo->prepare('INSERT INTO lists (title, created_by, status, created_at) VALUES (?, ?, \'draft\', ?)')
            ->execute([$title, $user, $now]);
        respond(['id' => (int)$pdo->lastInsertId()]);

    case 'delete_list':
        $list = find_list((int)($input['list_id'] ?? 0));
        require_owner($list, $user);
        $pdo->prepare('DELETE FROM lists WHERE id = ?')->execute([$list['id']]);
        respond(['ok' => true]);

    case 'add_item':
        $list = find_list((int)($input['list_id'] ?? 0));
        require_owner($list, $user);
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
        } else {
            $type = null;
        }
        $pdo->prepare('INSERT INTO items (list_id, name, type, quality, component_type, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            ->execute([$list['id'], $name, $type, $quality, $componentType, $now]);
        respond(['list' => list_detail((int)$list['id'])]);

    case 'delete_item':
        $stmt = $pdo->prepare('SELECT list_id FROM items WHERE id = ?');
        $stmt->execute([(int)($input['item_id'] ?? 0)]);
        $listId = $stmt->fetchColumn();
        if ($listId === false) {
            fail('Item nicht gefunden.', 404);
        }
        $list = find_list((int)$listId);
        require_owner($list, $user);
        if ($list['status'] !== 'draft') {
            fail('Die Liste ist bereits freigegeben.');
        }
        $pdo->prepare('DELETE FROM items WHERE id = ?')->execute([(int)$input['item_id']]);
        respond(['list' => list_detail((int)$list['id'])]);

    case 'publish':
        $list = find_list((int)($input['list_id'] ?? 0));
        require_owner($list, $user);
        if ($list['status'] !== 'draft') {
            fail('Die Liste ist bereits freigegeben.');
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
        if ($list['status'] !== 'open') {
            fail('Nur offene Listen können abgeschlossen werden.');
        }
        $pdo->prepare('UPDATE lists SET status = \'closed\' WHERE id = ?')->execute([$list['id']]);
        respond(['list' => list_detail((int)$list['id'])]);

    case 'roll':
        $kind = $input['kind'] ?? '';
        if (!isset(ROLL_MAX[$kind])) {
            fail('Ungültige Wurfart.');
        }
        $stmt = $pdo->prepare('SELECT list_id FROM items WHERE id = ?');
        $stmt->execute([(int)($input['item_id'] ?? 0)]);
        $listId = $stmt->fetchColumn();
        if ($listId === false) {
            fail('Item nicht gefunden.', 404);
        }
        $list = find_list((int)$listId);
        if ($list['status'] !== 'open') {
            fail('Auf diese Liste kann nicht (mehr) gewürfelt werden.');
        }
        try {
            $pdo->prepare('INSERT INTO rolls (item_id, username, kind, value, created_at) VALUES (?, ?, ?, ?, ?)')
                ->execute([(int)$input['item_id'], $user, $kind, random_int(0, ROLL_MAX[$kind]), $now]);
        } catch (PDOException $e) {
            if (str_contains($e->getMessage(), 'UNIQUE')) {
                fail('Du hast auf dieses Item bereits gewürfelt.', 409);
            }
            throw $e;
        }
        respond(['list' => list_detail((int)$list['id'])]);
}

fail('Unbekannte Aktion.', 404);
