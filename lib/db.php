<?php
declare(strict_types=1);

const DATA_DIR = __DIR__ . '/../data';
const DB_FILE = DATA_DIR . '/loot.sqlite';

function db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }

    if (!extension_loaded('pdo_sqlite')) {
        throw new RuntimeException('Die PHP-Erweiterung pdo_sqlite ist nicht installiert.');
    }
    if (!is_dir(DATA_DIR) && !@mkdir(DATA_DIR, 0775, true)) {
        throw new RuntimeException('Der Ordner data/ fehlt und konnte nicht angelegt werden.');
    }
    // SQLite braucht Schreibrechte auf den Ordner (Journal-Datei) und die Datei selbst.
    if (!is_writable(DATA_DIR)) {
        throw new RuntimeException('Der Ordner data/ ist für PHP nicht beschreibbar (Rechte z. B. 775 oder 777 setzen).');
    }
    if (is_file(DB_FILE) && !is_writable(DB_FILE)) {
        throw new RuntimeException('Die Datei data/loot.sqlite ist für PHP nicht beschreibbar.');
    }

    $pdo = new PDO('sqlite:' . DB_FILE, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec('PRAGMA busy_timeout = 5000');

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS lists (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            title       TEXT    NOT NULL,
            created_by  TEXT    NOT NULL,
            status      TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed')),
            created_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS items (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            list_id         INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
            name            TEXT    NOT NULL,
            type            TEXT    NULL CHECK (type IS NULL OR type IN ('ore','component')),
            quality         INTEGER NULL,
            component_type  TEXT    NULL,
            created_at      INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS rolls (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
            username    TEXT    NOT NULL COLLATE NOCASE,
            kind        TEXT    NOT NULL CHECK (kind IN ('main','twink','pass')),
            value       INTEGER NULL,
            created_at  INTEGER NOT NULL,
            UNIQUE (item_id, username)
        );
        CREATE INDEX IF NOT EXISTS idx_items_list ON items(list_id);
        CREATE INDEX IF NOT EXISTS idx_rolls_item ON rolls(item_id);
    ");

    // Spalten, die nach der ersten Version dazugekommen sind.
    add_column($pdo, 'lists', 'deadline', 'INTEGER NULL');
    add_column($pdo, 'lists', 'archived', 'INTEGER NOT NULL DEFAULT 0');
    add_column($pdo, 'items', 'done', 'INTEGER NOT NULL DEFAULT 0');
    add_column($pdo, 'items', 'component_class', 'TEXT NULL');
    migrate_rolls_pass($pdo);

    return $pdo;
}

function add_column(PDO $pdo, string $table, string $column, string $definition): void
{
    $columns = array_column($pdo->query("PRAGMA table_info($table)")->fetchAll(), 'name');
    if (!in_array($column, $columns, true)) {
        $pdo->exec("ALTER TABLE $table ADD COLUMN $column $definition");
    }
}

/** Alte rolls-Tabelle kennt "Kein Interesse" (kind = pass, ohne Wert) noch nicht – Tabelle neu aufbauen. */
function migrate_rolls_pass(PDO $pdo): void
{
    $sql = (string)$pdo->query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'rolls'")->fetchColumn();
    if ($sql === '' || strpos($sql, "'pass'") !== false) {
        return;
    }
    $pdo->beginTransaction();
    try {
        $pdo->exec("
            CREATE TABLE rolls_new (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
                username    TEXT    NOT NULL COLLATE NOCASE,
                kind        TEXT    NOT NULL CHECK (kind IN ('main','twink','pass')),
                value       INTEGER NULL,
                created_at  INTEGER NOT NULL,
                UNIQUE (item_id, username)
            );
            INSERT INTO rolls_new (id, item_id, username, kind, value, created_at)
                SELECT id, item_id, username, kind, value, created_at FROM rolls;
            DROP TABLE rolls;
            ALTER TABLE rolls_new RENAME TO rolls;
            CREATE INDEX IF NOT EXISTS idx_rolls_item ON rolls(item_id);
        ");
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}
