<?php
declare(strict_types=1);

function db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }

    $dir = __DIR__ . '/../data';
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }

    $pdo = new PDO('sqlite:' . $dir . '/loot.sqlite', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec('PRAGMA journal_mode = WAL');
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
            kind        TEXT    NOT NULL CHECK (kind IN ('main','twink')),
            value       INTEGER NOT NULL,
            created_at  INTEGER NOT NULL,
            UNIQUE (item_id, username)
        );
        CREATE INDEX IF NOT EXISTS idx_items_list ON items(list_id);
        CREATE INDEX IF NOT EXISTS idx_rolls_item ON rolls(item_id);
    ");

    return $pdo;
}
