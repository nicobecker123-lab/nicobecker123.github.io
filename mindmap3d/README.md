# SystemOS 3D-Sandkasten

Statische App (kein Build): eine 3D-Box als Sandkasten, darin drei Mindmaps entlang der Achsen X, Y und Z.
Start: Repo über GitHub Pages ausliefern und `/mindmap3d/` öffnen, lokal z. B. `python3 -m http.server` im Repo-Root.

## Bedienung
- **Kamera:** links ziehen = drehen, rechts ziehen = verschieben, Mausrad = Zoom.
- **Knoten:** ziehen = Ast samt Unterbaum bewegen, Klick = auf-/zuklappen, Doppelklick = Kamera fokussiert.
- **Bewegen-Modus:** Frei, oder auf Achse X / Y / Z eingeschränkt (Tasten X / Y / Z, nochmal drücken = frei).
- **Ebenen-Stufen 1–4** (Tasten 1–4, oder + / −): kompakt, normal, weit, sehr weit. Die Ebenen gleiten animiert auseinander oder zusammen. Der Platz passt sich dynamisch an: Der Ebenenabstand wächst mit der Zahl sichtbarer Knoten, und der Querabstand verhindert Überlappungen.
- **Filter:** Name/Pfad-Text, Status-/Typ-Chips (Live, Risiko, Ordner, Datei …) und Achsen X/Y/Z einzeln ein- und ausblenden. Es bleiben die Treffer samt Pfad zur Wurzel sichtbar, der Rest fällt aus dem Layout, sodass der Platz neu verteilt wird. Nicht passende Pfadknoten sind kleiner dargestellt.
- **Tiefe:** klappt alle Knoten bis zur gewählten Tiefe auf. **Labels:** bis zu welcher Tiefe Beschriftungen stehen.
- **Suche:** Name oder Pfad, „Weiter“ springt zum nächsten Treffer und klappt den Weg dorthin auf.

## Verknüpfungen (Node-Editor)
- **Verknüpfen** (Taste L, oder beim Ziehen Shift halten): von einem Knoten auf einen Zielknoten ziehen, es entsteht eine gerichtete Verbindung, auch über Äste und Achsen hinweg.
- **Verknüpfungen** öffnet die Liste: Beschriftung setzen, Richtung umkehren (⇄), löschen (×), zur Verbindung fliegen.
- Ist ein Endpunkt zugeklappt, endet die Linie am nächsten sichtbaren Vorfahren. Die Verknüpfungen werden mit dem Zustand gespeichert.

## Meilensteine (Fortschritt messen)
**Meilensteine** markiert Zwischenstände mit Name, Notiz, Datum und Kennzahlen: erfasste Dokumente (mit Prozent und Balken), Knoten, Verknüpfungen, verschobene Äste, angehängte Scans.
- Die Karte **Jetzt** zeigt den laufenden Stand mit Differenz zum letzten Meilenstein (grün = plus).
- **Laden** stellt einen Zwischenstand vollständig wieder her, sofern er klein genug für den Browser-Speicher ist. **Löschen** entfernt ihn.
- Beim ersten Öffnen wird automatisch ein Ausgangspunkt markiert. `data/milestones.json` enthält feste Referenzstände (Zustandskarte 25.09., altes Nexus-Dashboard mit geschätztem Datum).
- Meilensteine werden mit „Zustand speichern“ und beim Export gesichert.

## Startansicht
**Startansicht setzen** fixiert die aktuelle Kameraposition. Nach „Zustand speichern“ startet die App immer dort, der Button **Ansicht** fliegt dorthin zurück.

## Lexikon
Button **Lexikon**: listet jedes Dokument (Datei-Knoten) aller Achsen, nach Ordner gegliedert, ohne Doppelte (gleicher Pfad = ein Eintrag).
- **Erfassen & weiter** hakt das aktuelle Dokument ab, springt zum nächsten offenen und fliegt dort hin. **Weiter** überspringt, **Zurück** geht zurück.
- Filter nach Name oder Ordner, „nur offene“ blendet Erfasstes aus. Angehängte Scans (z. B. der Konzeptordner) erscheinen automatisch.
- Der Erfassungsstand steckt im gespeicherten Zustand. **Als Markdown exportieren** schreibt `lexikon.md` mit Häkchen.

## Zustand speichern
- **Zustand speichern** (Strg+S): Browser-Speicher (`localStorage`), wird beim nächsten Öffnen wiederhergestellt.
- **Export / Import:** dieselbe Momentaufnahme als JSON-Datei für den nächsten Schritt oder ein anderes Gerät.
- Gespeichert werden Startansicht, Ebenen-Stufe, Filter, Verknüpfungen, aufgeklappte Knoten, verschobene Äste, angehängte Scans, Lexikon-Stand und Einstellungen.

## Daten
- `data/systemos.json` ist die „SystemOS Zustandskarte“ (Claude-Artifact). In `app.js` (`AXES`) hat jede Achse ein eigenes
  `source`-Feld. Aktuell zeigen alle drei auf dieselbe Datei, weil die drei übergebenen Artifact-Links identisch waren.
- Die Zustandskarte kürzt große Ordner („… 23 weitere Ordner“). Für die volle Ordnerebene bis zur letzten Datei:

  ```
  python3 mindmap3d/tools/scan_folder.py <ordner> [<ordner> ...] -o scan.json --name Name
  ```

  Unter Windows ohne Python: `tools/Start-OrnithKonzeptCrawler.ps1` als Datei speichern und mit
  `powershell -ExecutionPolicy Bypass -File .\Start-OrnithKonzeptCrawler.ps1` starten (nicht in die Konsole einfügen);
  es schreibt `konzeptordner_mindmap.json` (Baum) und ein Manifest mit SHA-256.

  In der App den Zielknoten wählen und **Ordner-Scan anhängen** klicken.
  `data/repos-scan.json` ist ein Scan der Repos dieses Kontos (Button **Repo-Scan laden**).

`vendor/` enthält three.js r170 (MIT) samt OrbitControls, damit die Seite ohne CDN läuft.
