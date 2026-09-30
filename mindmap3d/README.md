# SystemOS 3D-Sandkasten

Statische App (kein Build): eine 3D-Box als Sandkasten, darin drei Mindmaps entlang der Achsen X, Y und Z.
Start: Repo über GitHub Pages ausliefern und `/mindmap3d/` öffnen, lokal z. B. `python3 -m http.server` im Repo-Root.

## Bedienung
- **Kamera:** links ziehen = drehen, rechts ziehen = verschieben, Mausrad = Zoom.
- **Knoten:** ziehen = Ast samt Unterbaum bewegen, Klick = auf-/zuklappen, Doppelklick = Kamera fokussiert.
- **Bewegen-Modus:** Frei, oder auf Achse X / Y / Z eingeschränkt (Tasten 1–4).
- **Ebene:** klappt alle Knoten bis zur gewählten Tiefe auf. **Labels:** bis zu welcher Tiefe Beschriftungen stehen.
- **Suche:** Name oder Pfad, „Weiter“ springt zum nächsten Treffer und klappt den Weg dorthin auf.

## Lexikon
Button **Lexikon**: listet jedes Dokument (Datei-Knoten) aller Achsen, nach Ordner gegliedert, ohne Doppelte (gleicher Pfad = ein Eintrag).
- **Erfassen & weiter** hakt das aktuelle Dokument ab, springt zum nächsten offenen und fliegt dort hin. **Weiter** überspringt, **Zurück** geht zurück.
- Filter nach Name oder Ordner, „nur offene“ blendet Erfasstes aus. Angehängte Scans (z. B. der Konzeptordner) erscheinen automatisch.
- Der Erfassungsstand steckt im gespeicherten Zustand. **Als Markdown exportieren** schreibt `lexikon.md` mit Häkchen.

## Zustand speichern
- **Zustand speichern** (Strg+S): Browser-Speicher (`localStorage`), wird beim nächsten Öffnen wiederhergestellt.
- **Export / Import:** dieselbe Momentaufnahme als JSON-Datei für den nächsten Schritt oder ein anderes Gerät.
- Gespeichert werden Kamera, aufgeklappte Knoten, verschobene Äste, angehängte Scans, Lexikon-Stand und Einstellungen.

## Daten
- `data/systemos.json` ist die „SystemOS Zustandskarte“ (Claude-Artifact). In `app.js` (`AXES`) hat jede Achse ein eigenes
  `source`-Feld. Aktuell zeigen alle drei auf dieselbe Datei, weil die drei übergebenen Artifact-Links identisch waren.
- Die Zustandskarte kürzt große Ordner („… 23 weitere Ordner“). Für die volle Ordnerebene bis zur letzten Datei:

  ```
  python3 mindmap3d/tools/scan_folder.py <ordner> [<ordner> ...] -o scan.json --name Name
  ```

  In der App den Zielknoten wählen und **Ordner-Scan anhängen** klicken.
  `data/repos-scan.json` ist ein Scan der Repos dieses Kontos (Button **Repo-Scan laden**).

`vendor/` enthält three.js r170 (MIT) samt OrbitControls, damit die Seite ohne CDN läuft.
