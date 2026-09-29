<?php
declare(strict_types=1);

// Auswahllisten für das Item-Formular und Live-Katalog aus der star-citizen.wiki-API.

// Item-Arten (items.type). "ore" gibt es nur noch für alte Einträge.
const ITEM_KINDS = ['component', 'weapon', 'commodity', 'item'];

// Schiffskomponenten-Kategorien: gespeicherter Schlüssel => Anzeige.
const COMPONENT_CATEGORIES = [
    'Power Plant' => 'Power Plant',
    'Cooler' => 'Kühler',
    'Shield Generator' => 'Schild',
    'Quantum Drive' => 'Quantum Drive',
    'Radar' => 'Radar',
];
const COMPONENT_CLASSES = ['Military', 'Civilian', 'Industrial', 'Stealth', 'Competition'];
const COMPONENT_GRADES = ['A', 'B', 'C', 'D'];
const WEAPON_TYPES = ['Energie', 'Ballistisch', 'Distortion'];
const ITEM_TYPES = [
    'Pistole', 'Sturmgewehr', 'SMG', 'Schrotflinte', 'Scharfschützengewehr', 'LMG', 'Raketenwerfer',
    'Granatwerfer', 'Railgun', 'Messer', 'Granate', 'Helm', 'Brustpanzerung', 'Armpanzerung',
    'Beinpanzerung', 'Undersuit', 'Rucksack', 'Waffenaufsatz', 'Medizin', 'Werkzeug', 'Sonstiges',
];
const ARMOR_WEIGHTS = ['Leicht', 'Mittel', 'Schwer'];
const MAX_SIZE = 12;

// Per Umgebungsvariable überschreibbar (z. B. für Tests gegen eine Mock-API).
define('CATALOG_API', getenv('LOOTROLL_CATALOG_API') ?: 'https://api.star-citizen.wiki/api/v2');
const CATALOG_TTL = 86400;        // erfolgreicher Abruf gilt 24 h
const CATALOG_RETRY = 600;        // nach einem Fehler frühestens nach 10 min erneut versuchen
const CATALOG_PAGE_SIZE = 500;
const CATALOG_MAX_PAGES = 40;

// Spiel-interne Item-Typen, die pro Katalog abgefragt werden.
const CATALOG_SOURCES = [
    'component' => ['PowerPlant', 'Cooler', 'Shield', 'QuantumDrive', 'Radar'],
    'weapon' => ['WeaponGun'],
    'item' => [
        'WeaponPersonal', 'Char_Armor_Helmet', 'Char_Armor_Torso', 'Char_Armor_Arms', 'Char_Armor_Legs',
        'Char_Armor_Backpack', 'Char_Clothing_Undersuit', 'WeaponAttachment', 'FPS_Consumable',
    ],
];

const GAME_TYPE_CATEGORY = [
    'powerplant' => 'Power Plant',
    'cooler' => 'Cooler',
    'shield' => 'Shield Generator',
    'quantumdrive' => 'Quantum Drive',
    'radar' => 'Radar',
];

const GAME_TYPE_ITEM = [
    'char_armor_helmet' => 'Helm',
    'char_armor_torso' => 'Brustpanzerung',
    'char_armor_arms' => 'Armpanzerung',
    'char_armor_legs' => 'Beinpanzerung',
    'char_armor_backpack' => 'Rucksack',
    'char_clothing_undersuit' => 'Undersuit',
    'weaponattachment' => 'Waffenaufsatz',
];

function catalog_file(string $kind): string
{
    return DATA_DIR . '/catalog-' . $kind . '.json';
}

function catalog_read(string $kind): ?array
{
    $file = catalog_file($kind);
    if (!is_file($file)) {
        return null;
    }
    $data = json_decode((string)@file_get_contents($file), true);
    return is_array($data) ? $data : null;
}

/** Katalog aus dem Cache; bei Bedarf (TTL abgelaufen) neu von der API laden. */
function catalog(string $kind): array
{
    $cache = catalog_read($kind);
    $now = time();
    $fresh = $cache && !empty($cache['items']) && $now - (int)($cache['fetched_at'] ?? 0) < CATALOG_TTL;
    $recentFail = $cache && $now - (int)($cache['attempted_at'] ?? 0) < CATALOG_RETRY;
    if ($fresh || $recentFail) {
        return catalog_response($cache);
    }

    if (!is_dir(DATA_DIR) || !is_writable(DATA_DIR)) {
        return catalog_response($cache, 'Der Ordner data/ ist nicht beschreibbar – Katalog kann nicht gespeichert werden.');
    }

    // Nur ein Request baut den Katalog neu auf; andere bekommen solange den alten Stand.
    $lock = fopen(catalog_file($kind) . '.lock', 'c');
    if ($lock === false) {
        return catalog_response($cache);
    }
    try {
        if (!flock($lock, $cache ? LOCK_EX | LOCK_NB : LOCK_EX)) {
            return catalog_response($cache);
        }
        // Evtl. hat ein paralleler Request den Katalog inzwischen erneuert.
        $current = catalog_read($kind);
        if ($current && (int)($current['attempted_at'] ?? 0) > (int)($cache['attempted_at'] ?? 0)) {
            return catalog_response($current);
        }

        @set_time_limit(180);
        $record = ['fetched_at' => (int)($cache['fetched_at'] ?? 0), 'attempted_at' => $now, 'error' => null, 'items' => $cache['items'] ?? []];
        try {
            $items = catalog_fetch($kind);
            if (!$items) {
                throw new RuntimeException('Die API hat keine passenden Einträge geliefert.');
            }
            $record['items'] = $items;
            $record['fetched_at'] = $now;
        } catch (Throwable $e) {
            error_log('[lootroll] Katalog ' . $kind . ': ' . $e->getMessage());
            $record['error'] = $e->getMessage();
        }
        file_put_contents(catalog_file($kind), json_encode($record, JSON_UNESCAPED_UNICODE), LOCK_EX);
        return catalog_response($record);
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

function catalog_response(?array $record, ?string $error = null): array
{
    return [
        'items' => $record['items'] ?? [],
        'fetched_at' => isset($record['fetched_at']) && $record['fetched_at'] ? (int)$record['fetched_at'] : null,
        'error' => $error ?? ($record['error'] ?? null),
    ];
}

function catalog_status(): array
{
    $status = [];
    foreach (array_keys(CATALOG_SOURCES) as $kind) {
        $cache = catalog_read($kind);
        $status[$kind] = $cache
            ? ['entries' => count($cache['items'] ?? []), 'fetched_at' => $cache['fetched_at'] ?? null, 'error' => $cache['error'] ?? null]
            : 'noch nicht geladen';
    }
    return $status;
}

// ---------- API-Abruf ----------

function http_get_json(string $url): array
{
    $headers = ['Accept: application/json', 'User-Agent: PhoenixLootroll/1.0'];
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => 40,
            CURLOPT_HTTPHEADER => $headers,
        ]);
        $body = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);
        if ($body === false) {
            throw new RuntimeException('API nicht erreichbar: ' . $error);
        }
    } elseif (filter_var(ini_get('allow_url_fopen'), FILTER_VALIDATE_BOOLEAN)) {
        $context = stream_context_create(['http' => [
            'header' => implode("\r\n", $headers),
            'timeout' => 40,
            'ignore_errors' => true,
        ]]);
        $body = @file_get_contents($url, false, $context);
        if ($body === false) {
            throw new RuntimeException('API nicht erreichbar.');
        }
        $status = 200;
        foreach ($http_response_header ?? [] as $line) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m)) {
                $status = (int)$m[1];
            }
        }
    } else {
        throw new RuntimeException('Weder curl noch allow_url_fopen sind verfügbar – der Server kann die API nicht abfragen.');
    }
    if ($status >= 400) {
        throw new RuntimeException("API antwortet mit HTTP $status.");
    }
    $data = json_decode((string)$body, true);
    if (!is_array($data)) {
        throw new RuntimeException('API liefert kein gültiges JSON.');
    }
    return $data;
}

/** Alle Einträge eines Spiel-Item-Typs (paginiert). Filtert zusätzlich lokal, falls die API den Filter ignoriert. */
function fetch_game_type(string $gameType): array
{
    $rows = [];
    for ($page = 1; $page <= CATALOG_MAX_PAGES; $page++) {
        $query = http_build_query([
            'filter' => ['type' => $gameType],
            'limit' => CATALOG_PAGE_SIZE,
            'page' => $page,
        ]);
        $data = http_get_json(CATALOG_API . '/items?' . $query);
        $batch = isset($data['data']) && is_array($data['data']) ? $data['data'] : (array_is_list_compat($data) ? $data : []);
        foreach ($batch as $row) {
            if (is_array($row) && strcasecmp((string)field($row, ['type']), $gameType) === 0) {
                $rows[] = $row;
            }
        }
        $last = (int)(field($data, ['meta.last_page']) ?? 0);
        $next = field($data, ['links.next']);
        if (!$batch || ($last > 0 ? $page >= $last : !$next)) {
            break;
        }
    }
    return $rows;
}

function catalog_fetch(string $kind): array
{
    $entries = [];
    foreach (CATALOG_SOURCES[$kind] as $gameType) {
        foreach (fetch_game_type($gameType) as $row) {
            $entry = normalize_entry($kind, $row);
            if ($entry !== null) {
                $entries[str_lower($entry['n'])] = $entry;
            }
        }
    }
    $entries = array_values($entries);
    usort($entries, function ($a, $b) { return strnatcasecmp($a['n'], $b['n']); });
    return $entries;
}

// ---------- Normalisierung ----------

function array_is_list_compat(array $a): bool
{
    return $a === [] || array_keys($a) === range(0, count($a) - 1);
}

/** Erstes nicht-leeres Feld aus einer Liste möglicher (Punkt-)Pfade. */
function field(array $row, array $paths)
{
    foreach ($paths as $path) {
        $value = $row;
        foreach (explode('.', $path) as $key) {
            if (!is_array($value) || !array_key_exists($key, $value)) {
                $value = null;
                break;
            }
            $value = $value[$key];
        }
        if ($value !== null && $value !== '' && $value !== []) {
            return $value;
        }
    }
    return null;
}

function text_value($value): string
{
    if (is_array($value)) {
        // Lokalisierte Texte, z. B. {"en_EN": "..."}
        $value = $value['en_EN'] ?? $value['en'] ?? $value['de_DE'] ?? reset($value);
    }
    return is_scalar($value) ? trim((string)$value) : '';
}

/** Wert aus der Spielbeschreibung, z. B. "Item Type: Laser Repeater". */
function desc_attr(string $desc, string $label): string
{
    $desc = str_replace(['\\n', "\r"], ["\n", ''], $desc);
    return preg_match('/(?:^|\n)\s*' . preg_quote($label, '/') . '\s*:\s*([^\n]+)/i', $desc, $m) ? trim($m[1]) : '';
}

function normalize_entry(string $kind, array $row): ?array
{
    $name = text_value(field($row, ['name']));
    if ($name === '' || stripos($name, 'placeholder') !== false || strpos($name, '[PH]') !== false || $name[0] === '<') {
        return null;
    }
    $name = str_cut($name, 100);
    $desc = text_value(field($row, ['description', 'descriptions']));
    $gameType = str_lower(text_value(field($row, ['type'])));
    $manufacturer = text_value(field($row, ['manufacturer.name', 'manufacturer']));
    if ($manufacturer === '' || stripos($manufacturer, 'unknown') !== false) {
        $manufacturer = desc_attr($desc, 'Manufacturer');
    }
    $sizeRaw = field($row, ['size']) ?? desc_attr($desc, 'Size');
    $size = is_numeric($sizeRaw) && (int)$sizeRaw >= 0 && (int)$sizeRaw <= MAX_SIZE ? (int)$sizeRaw : null;
    $itemType = desc_attr($desc, 'Item Type');

    $entry = ['n' => $name];
    if ($kind === 'component') {
        $category = GAME_TYPE_CATEGORY[$gameType] ?? null;
        if ($category === null) {
            return null;
        }
        $entry['c'] = $category;
        $entry['s'] = $size;
        $entry['k'] = normalize_class(text_value(field($row, ['class'])) ?: desc_attr($desc, 'Class'));
        $entry['g'] = normalize_grade(field($row, ['grade']) ?? desc_attr($desc, 'Grade'));
    } elseif ($kind === 'weapon') {
        $entry['s'] = $size;
        $entry['t'] = weapon_type(implode(' ', [
            $itemType,
            text_value(field($row, ['sub_type', 'classification'])),
            text_value(field($row, ['vehicle_weapon.damage_type', 'damage_type'])),
            $name,
        ]));
    } else {
        $entry['t'] = item_type($gameType, $itemType, text_value(field($row, ['sub_type'])), $name);
        if ($gameType === 'fps_consumable' && $entry['t'] !== 'Medizin') {
            return null; // Essen & Trinken sind kein Loot
        }
        if (in_array($entry['t'], ['Helm', 'Brustpanzerung', 'Armpanzerung', 'Beinpanzerung', 'Rucksack'], true)) {
            $entry['a'] = armor_weight($itemType . ' ' . text_value(field($row, ['sub_type', 'armor.weight'])) . ' ' . $name);
        }
    }
    if ($manufacturer !== '') {
        $entry['m'] = str_cut($manufacturer, 60);
    }
    return array_filter($entry, function ($v) { return $v !== null && $v !== ''; });
}

function normalize_class(string $value): ?string
{
    foreach (COMPONENT_CLASSES as $class) {
        if (stripos($value, $class) !== false) {
            return $class;
        }
    }
    if (stripos($value, 'civil') !== false) {
        return 'Civilian';
    }
    return null;
}

function normalize_grade($value): ?string
{
    if (is_numeric($value) && (int)$value >= 1 && (int)$value <= 4) {
        return COMPONENT_GRADES[(int)$value - 1];
    }
    $value = strtoupper(trim((string)$value));
    return in_array($value, COMPONENT_GRADES, true) ? $value : null;
}

function weapon_type(string $text): ?string
{
    $text = str_lower($text);
    if (strpos($text, 'distortion') !== false) {
        return 'Distortion';
    }
    if (preg_match('/ballistic|mass driver|physical|autocannon/', $text)) {
        return 'Ballistisch';
    }
    if (preg_match('/laser|energy|neutron|tachyon|plasma|ion\b|scattergun/', $text)) {
        return 'Energie';
    }
    return null;
}

function item_type(string $gameType, string $itemType, string $subType, string $name): string
{
    if (isset(GAME_TYPE_ITEM[$gameType])) {
        return GAME_TYPE_ITEM[$gameType];
    }
    $text = str_lower($itemType . ' ' . $subType . ' ' . $name);
    $rules = [
        'Granatwerfer' => '/grenade launcher/',
        'Raketenwerfer' => '/rocket|missile launcher|launcher/',
        'Scharfschützengewehr' => '/sniper/',
        'Railgun' => '/railgun/',
        'LMG' => '/\blmg\b|light machine/',
        'SMG' => '/\bsmg\b|submachine/',
        'Schrotflinte' => '/shotgun/',
        'Sturmgewehr' => '/assault rifle|\brifle\b/',
        'Pistole' => '/pistol/',
        'Messer' => '/knife/',
        'Granate' => '/grenade/',
        'Medizin' => '/med(ical|pen|gun)|hemozal|adrenapen|detox|opioid|resurgera|corticopen|demexatrine|sterogen|roxaphen|canoiodide/',
        'Werkzeug' => '/multi-?tool|tractor|gadget|tool|cambio|salvage|mining/',
    ];
    foreach ($rules as $type => $pattern) {
        if (preg_match($pattern, $text)) {
            return $type;
        }
    }
    return 'Sonstiges';
}

function armor_weight(string $text): ?string
{
    $text = str_lower($text);
    if (strpos($text, 'heavy') !== false) {
        return 'Schwer';
    }
    if (strpos($text, 'medium') !== false) {
        return 'Mittel';
    }
    if (strpos($text, 'light') !== false) {
        return 'Leicht';
    }
    return null;
}
