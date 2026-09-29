# Phoenix Lootroll

Einfache Loot-Verteilung im Stil des alten WoW-Need-Rolls – für Star-Citizen-Loot (Komponenten, Schiffswaffen, Commodities & Items).

- Kein Login: Username frei wählbar, wird 365 Tage im Cookie `loot_user` gespeichert (bei jedem Besuch erneuert)
- Jeder kann Lootlisten anlegen und Items eintragen; das zuletzt erfasste Item steht oben. Erstes Feld ist die **Art**, die weiteren Felder passen sich an:
  - **Komponente**: Kategorie (Power Plant, Kühler, Schild, Quantum Drive, Radar) → Name → Klasse (Military, Civilian …) → Grade A–D → Size
  - **Schiffswaffe**: Waffe → Size → Typ (Energie/Ballistisch/Distortion) → Hersteller
  - **Commodity**: Name → Menge → Qualität (optional)
  - **Item**: Item-Name → Typ (Pistole, Sturmgewehr, Brustpanzerung, Undersuit …) → Rüstungsklasse (bei Rüstung) → Hersteller → Anzahl
  - Namensfelder mit Vorschlagsliste, die sich beim Tippen verkleinert; bei Auswahl werden Klasse/Grade/Size/Typ automatisch ausgefüllt. Unbekannte Namen können frei eingetragen werden.
- Jede Liste hat eine **Pflicht-Deadline**; danach endet das Würfeln automatisch (der Ersteller kann verlängern)
- Nach „Speichern & freigeben“ entscheidet jeder bis zur Deadline **einmal pro Item**: **Priorität 0–100**, **Gier 0–50** oder **Kein Interesse** (kann bis zur Deadline zurückgenommen werden)
- Im Listen-Kopf steht, wer schon abgestimmt hat (✔ = bei allen offenen Items entschieden)
- Würfe werden serverseitig erzeugt; Priorität schlägt Gier, sonst gewinnt der höchste Wert (Gleichstand wird angezeigt)
- Ersteller kann Items als **erledigt** markieren, die Verteilung abschließen, die Liste **archivieren**/wiederherstellen oder löschen
- Ansicht aktualisiert sich automatisch alle 5 Sekunden

## Voraussetzungen

- PHP **7.4+** mit `pdo_sqlite` (`mbstring` optional)
- Schreibrechte des Webservers auf `data/` (dort wird `loot.sqlite` automatisch angelegt; Rechte z. B. 775 bzw. 777)
- Für den Item-Katalog: ausgehende HTTPS-Verbindungen und `curl` **oder** `allow_url_fopen`

## Item-Katalog

Komponenten, Schiffswaffen und Items werden live von der [star-citizen.wiki-API](https://api.star-citizen.wiki) geladen
(`lib/catalog.php`) und 24 Stunden in `data/catalog-*.json` zwischengespeichert. Schlägt der Abruf fehl, wird der letzte
Stand weiter genutzt und frühestens nach 10 Minuten erneut versucht; ohne Katalog funktioniert das Formular per Freitext.
Zum Neuladen einfach die `data/catalog-*.json` löschen. Direkt prüfen: `api.php?action=catalog&kind=component|weapon|item`.

## Diagnose

`api.php?action=health` zeigt PHP-Version, Erweiterungen, ob die Datenbank beschreibbar ist und den Stand des Item-Katalogs.
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
