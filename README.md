# Phoenix Lootroll

Einfache Loot-Verteilung im Stil des alten WoW-Need-Rolls – für Star-Citizen-Loot (Erze & Schiffskomponenten).

- Kein Login: Username frei wählbar, wird 5 Tage im Cookie `loot_user` gespeichert
- Jeder kann Lootlisten anlegen und Items eintragen (Name Pflicht; Typ Erz → Qualität, Komponente → Komponenten-Typ)
- Nach „Speichern & freigeben“ darf jeder **einmal pro Item** würfeln: **Main 0–100** oder **Twink 0–50**
- Würfe werden serverseitig erzeugt; Main schlägt Twink, sonst gewinnt der höchste Wert (Gleichstand wird angezeigt)
- Ersteller kann die Verteilung abschließen oder die Liste löschen
- Ansicht aktualisiert sich automatisch alle 5 Sekunden

## Voraussetzungen

- PHP **8.1+** mit `pdo_sqlite`
- Schreibrechte des Webservers auf `data/` (dort wird `loot.sqlite` automatisch angelegt)

## Deployment

Repo-Inhalt in ein Verzeichnis des Webspaces kopieren (z. B. `/lootroll/`). Bei Apache schützen die
`.htaccess`-Dateien `data/` und `lib/`. Bei nginx diese Verzeichnisse manuell sperren:

```nginx
location ~ ^/lootroll/(data|lib)/ { deny all; }
```

## Lokal starten

```bash
php -S localhost:8000
```

## Design anpassen

Farben und Schriften stehen als CSS-Variablen ganz oben in `assets/style.css`.
