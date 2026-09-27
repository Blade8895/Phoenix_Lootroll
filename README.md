# Phoenix Lootroll

Einfache Loot-Verteilung im Stil des alten WoW-Need-Rolls – für Star-Citizen-Loot (Erze & Schiffskomponenten).

- Kein Login: Username frei wählbar, wird 5 Tage im Cookie `loot_user` gespeichert
- Jeder kann Lootlisten anlegen und Items eintragen (Name Pflicht; Typ Erz → Qualität, Komponente → Komponenten-Typ)
- Jede Liste hat eine **Pflicht-Deadline**; danach endet das Würfeln automatisch (der Ersteller kann verlängern)
- Nach „Speichern & freigeben“ darf jeder bis zur Deadline **einmal pro Item** würfeln: **Main 0–100** oder **Twink 0–50**
- Würfe werden serverseitig erzeugt; Main schlägt Twink, sonst gewinnt der höchste Wert (Gleichstand wird angezeigt)
- Ersteller kann Items als **erledigt** markieren, die Verteilung abschließen, die Liste **archivieren**/wiederherstellen oder löschen
- Ansicht aktualisiert sich automatisch alle 5 Sekunden

## Voraussetzungen

- PHP **7.4+** mit `pdo_sqlite` (`mbstring` optional)
- Schreibrechte des Webservers auf `data/` (dort wird `loot.sqlite` automatisch angelegt; Rechte z. B. 775 bzw. 777)

## Diagnose

`api.php?action=health` zeigt PHP-Version, Erweiterungen und ob die Datenbank beschreibbar ist.
Fehler der API werden immer als JSON mit Klartext-Meldung zurückgegeben und im Frontend angezeigt.
Bestehende Datenbanken werden beim ersten Aufruf automatisch um neue Spalten ergänzt.

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
