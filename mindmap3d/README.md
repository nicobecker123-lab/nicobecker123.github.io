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
- **Gamepad** (aus MyIsland/VRSpace.tsx übertragen): linker Stick bewegt Kamera und Blickpunkt gemeinsam (relativ zur Blickrichtung), rechter Stick sieht sich um (dreht nur die Kamera um den Blickpunkt), Knopf A/0 hoch, B/1 runter, Schultertasten schneller. Verbinden/Trennen meldet sich per Hinweis. Läuft nur auf dem Desktop, nicht während eines Kamera-Flugs oder in AR/VR.

## Monitor (läuft dauerhaft)
Die Leiste unten (Klick öffnet Details) läuft ab dem Laden im Takt, ohne Trigger und ohne Ausschalter. Sie zeigt nur an und führt nie etwas aus.
- **[+] WcT-Kollaps** (Kohärenz über 85 %) und **[~] Divergenz-Kavität** (unter 70 %), dazwischen neutral, mit 2 Punkten Hysterese. **Kohärenz** = 100 % × (1 − Widersprüche ÷ relevante Punkte). Widersprüche sind z. B. „Abgeschlossen“ bei Status Risiko/Offen, „Wartebereich“ bei Status Live, Risiko ohne Dev-Stand oder eine Verknüpfung mit fehlendem Endpunkt. Die Formel und die Widersprüche stehen im Panel.
- **[!] CreoAnalyze (Execution Intent):** Alle Knotentexte werden reihum dauerhaft auf Ausführungs-Muster geprüft (PowerShell/Shell-Befehle, eval/exec, kodierte Nutzlasten, Prompt-Injection). Dazu wird alles geprüft, was du tippst oder einfügst. Bestehende Treffer werden beim Start als Basis erfasst, nur **neue** lösen eine Anfrage aus. Treffer im eigenen Bestand lassen sich als „bekannt“ bestätigen.
- **Seat Governance:** Ein neuer Treffer oder der Wechsel in die Divergenz-Kavität legt eine offene Anfrage an (fail-closed). Der Operator gibt sie frei oder lehnt sie ab. Die Freigabe ist nur ein Vermerk. Dazu gibt es Zähler (Seat Redirects, Abbadon Vetos) und das Protokoll `TAIL_CALL.LOG`.
- Anfragen, Bestätigungen und Ergebnisse werden mit dem Zustand gespeichert und laufen in die Meilensteine ein.
- Das Neural HUD (`systemos_neural_hud.html`) würfelt die Kohärenz mit `Math.random()` und löst nur per Knopf aus. Hier wird sie aus den Daten des Sandkastens berechnet. Das Mikrofon des HUD ist eine Attrappe und wurde nicht übernommen.

## Neuronale Zustände
Button **Neuronale Zustände**: Jede Status-Kategorie (Live, Risiko, Offen, Neu, Archiv, Info, Ordner, Datei, Kern, Aktiv — die „Axiome“) hat einen eigenen Aktivierungswert, wie ein Neuron.
- **Dynamik:** Der Wert steigt schnell mit dem Anteil sichtbarer Knoten dieser Kategorie plus einem Schub bei frischer Aktivität (Dev-Stand geändert, neue Verknüpfung erstellt) und klingt danach langsam wieder ab (Leaky-Integrate, keine Zufallswerte). Läuft im Takt, unabhängig vom Panel.
- **Muster:** Die Kategorien stehen kreisförmig angeordnet; eine Kante zwischen zwei Kategorien ist so stark, wie oft echte Verknüpfungen (`state.links`) Knoten dieser beiden Kategorien verbinden. Das ist ein aus den echten Daten entstehendes Netz, keine Illustration.
- **Funkstelle (Hub):** Solange das Panel offen ist, erscheint ein Knoten in der Boxmitte, an dem die drei Achsen wie Kabel an einer Mehrfachsteckdose zusammenlaufen; seine Helligkeit folgt dem Mittelwert der Aktivierungswerte oben.
- **Gerät koppeln:** In Browsern mit Web-Bluetooth-Unterstützung (Chrome/Edge, HTTPS oder localhost) öffnet der Knopf die native Geräteauswahl (`navigator.bluetooth.requestDevice`). Jedes Gerät wird einzeln per Klick bestätigt und erscheint als eigener Knoten am Hub, mit „Trennen“-Knopf. Kein Hintergrund-Scan, keine WLAN-Geräte (dafür gibt es im Browser keine API), kein automatisches erneutes Verbinden. Ohne Unterstützung bleibt der Knopf ausgeblendet.

## Netzwerk (nmap)
- nmap läuft nicht im Browser. **`tools/Scan-OwnNetwork.ps1`** startet es und schreibt eine XML-Datei (`nmap -oX`). Der Button **Netzwerk** importiert sie als Ast: Rechner, darunter ihre Ports mit Dienst und Status.
- **Bewertung:** Offene Fernzugriffs- und Datendienste (SSH, RDP, SMB, Telnet, VNC, RPC, Datenbanken, Docker-API …) auf **anderen** Geräten sind `Risiko`, auf dem eigenen Rechner (127.x) nur `Info`. Gefilterte Ports sind `Offen`, andere offene Ports `Live`. Neue Risiko-Knoten ohne Dev-Stand senken die Kohärenz im Monitor, bis du sie in den Wartebereich stellst.
- **Schutzgeländer im Skript:** nur IP-Adressen aus privaten Netzen, keine Hostnamen, Bereiche höchstens /24, ausdrückliche Bestätigung „JA“, dass du Eigentümer oder Administrator bist, nur Ports und Diensterkennung (kein `-A`, keine Skripte, kein Ausnutzen). Es wurde ohne nmap geschrieben und ist ungetestet.
- `data/nmap-beispiel.xml` ist eine Beispieldatei mit erfundenen Werten (Button „Beispiel laden“).

## Überdeckung, Transparenz, AR/VR
- **Überdeckung:** Die Zeile oben links zeigt, wie viele Knoten im Bild ein anderes berühren. Ab 35 % kommt ein Hinweis (Ebenen-Stufe erhöhen, Filter oder JIT-Sicht).
- **Durchsicht:** Der Regler macht Knoten halbtransparent ohne Tiefenschreiben, damit man hindurch sieht.
- **Entzerren:** Beschriftungen, die sich überdecken oder zu klein sind, werden ausgeblendet. Gewählte und überfahrene Knoten behalten ihr Label.
- **AR/VR (WebXR) mit Controllern:** Die Knöpfe VR und AR erscheinen nur, wenn das Gerät eine Sitzung unterstützt. Nur die Karte (nicht der reale Raum) steht als Tischmodell etwa 1,2 m vor dir, im AR-Modus ohne Hintergrund.
  - **Zeigen + Trigger** an einem Knoten: wählen und auf-/zuklappen, wie ein Mausklick.
  - **Zeigen + Griff** an einem Knoten: seinen Ast verschieben (wie das Ziehen mit der Maus).
  - **Griff auf leeren Raum** (eine Hand): die ganze Karte verschieben ("Raum greifen").
  - **Griff mit beiden Händen**: die Karte um den Punkt zwischen den Händen drehen und skalieren (wie Pinch-Zoom, nur räumlich).
  - Die Controller-Logik wurde ohne echtes XR-Gerät per simulierten Controller-Posen durchgetestet (Auswahl, Ast-Ziehen, Ein- und Zweihand-Griff); der Sitzungsaufbau selbst (Tischmodell, Passthrough) ist weiterhin ungetestet, weil kein Gerät zur Verfügung stand.

## JIT-Sicht (Knoten entstehen nach Blick)
**JIT-Sicht** (Taste J oder ^) erzeugt Details erst, wenn du sie ansiehst, und läuft im Takt, solange der Schalter an ist.
- Ein zugeklappter Knoten klappt auf, wenn er im Bild liegt und nah genug ist. Die Bildmitte zählt mehr als der Rand. Neue Knoten wachsen ein.
- Aufgeklappte Knoten, die weit weg oder außerhalb des Bildes liegen, klappen wieder zu. Von Hand geöffnete Knoten, der gewählte Knoten und sein Pfad bleiben stehen.
- Es werden höchstens 2500 Knoten gleichzeitig gezeichnet, so bleibt auch ein Scan mit sehr vielen Dateien flüssig. Die nächsten 60 Knoten in Reichweite bekommen ihr Label.
- Der Regler daneben stellt die Reichweite ein. Die Zeile oben links zählt, wie viele Knoten erzeugt und verworfen wurden.
- Bei aktivem Filter pausiert die JIT-Sicht, weil dann der Filter bestimmt, was sichtbar ist. Beim Einschalten klappt alles Weitentfernte zu. Danach stellt der Regler „Tiefe“ die Ansicht wieder her.

## Objektiv
- **Objektiv** (Taste O): Eine Linse folgt dem Mauszeiger, dunkelt alles außerhalb ab und beschriftet nur die (bis zu 40) Knoten darin. Der Regler daneben stellt die Linsengröße ein. Die Linse ändert nichts an den Daten, sie ist eine reine Blickhilfe.
- **Objektive (Voreinstellungen)** im Filter-Panel: Alles, Risiko, Wartebereich, Abgeschlossen, Verknüpft. Sie setzen den Filter mit einem Klick.
- Das ist meine Umsetzung der Idee „Objektiv/Filter". Das externe Neural HUD wurde nicht übernommen, weil die Datei nicht vorlag.

## Sektoren, Volumen-Packing und Raster
- **Drei 120°-Sektoren:** Die drei Äste teilen den Würfel in drei gleiche Pyramiden um die Raumdiagonale. Ast X liegt bei x ≥ max(y, z), Ast Y bei y ≥ max(x, z), Ast Z bei z ≥ max(x, y). Jeder Ast kann seine Knoten frei in seinem Sektor positionieren. Knoten werden beim Ziehen in den Sektor geklemmt. **Sektoren** blendet die Begrenzungsflächen ein oder aus.
- **Volumeneffizientes Layout:** Auf jeder Ebene füllen die Knoten das Sektor-Quadrat gleichmäßig. Dabei wird die Reihenfolge einer Hilbert-Kurve benutzt, damit Geschwister und Kinder räumlich zusammenbleiben. Die Ebenenposition ist die kleinste, bei der jeder Knoten seinen Mindestabstand hat, also das kleinste eingenommene Volumen. Die Zeile oben links zeigt Volumen je Ast, Knoten je Volumen, Rastergröße und Boxgröße.
- **Raster mit Auto-Anpassung:** Die Rasterweite wird aus dem Platzbedarf gewählt (etwa zehn Zellen je Kante, gerundet auf 1/2/3/5 × 10ⁿ). Alle Ebenen rasten daran ein, und Box, Raster und Achsen wachsen mit, wenn mehr Platz nötig ist. Verschobene Äste aus einer älteren Layout-Version werden beim Laden verworfen.

## Node-Editor (2D, wie n8n)
- **Node-Editor** öffnet eine Arbeitsfläche mit Karten und Drähten. Die Drähte sind dieselben Verknüpfungen wie im 3D-Raum, Änderungen wirken in beide Richtungen.
- Karten hinzufügen: über die Suche, **+ Auswahl** (in 3D gewählter Knoten) oder **+ mit Kindern**. Beim Öffnen kommen alle Endpunkte bestehender Verknüpfungen automatisch dazu.
- Verbinden: vom Kreis (Port) einer Karte auf eine andere Karte ziehen. Draht anklicken + Entf löscht, Doppelklick auf den Draht beschriftet, Doppelklick auf eine Karte zeigt den Knoten in 3D. **Auto-Anordnen** ordnet die Karten nach Fluss von links nach rechts. Rad = Zoom, Hintergrund ziehen = verschieben.

## Obsidian
Button **Obsidian**: Konfiguration (Vault-Name, Export-Ordner, Wikilinks als Verknüpfungen) und beide Richtungen.
- **Import:** Ordner des Vault wählen. Alle Notizen (ohne `.obsidian`, `.git`, `.trash`) hängen als Ast unter dem gewählten Knoten, mit Tags und Textauszug. `[[Wikilinks]]` werden zu Verknüpfungen (bis 400, tote Links werden übersprungen). Im Detailpanel öffnet **In Obsidian öffnen** die Notiz per `obsidian://`-Link.
- **Export:** Eine Notiz je Knoten mit Frontmatter (Tags `status/…`, `dev/…`, Achse, Ebene, Pfad), Beschreibung, `## Verknüpfungen` und `## Kinder` als `[[Links]]`, dazu `_Mindmap-Index.md`. Exportiert wird der gewählte Knoten samt Unterbaum, sonst der bearbeitete Stand. Schreibt nur in den Export-Ordner im Vault und überschreibt gleichnamige Notizen dort. In Chrome und Edge wird direkt in den Vault geschrieben, in anderen Browsern kommt eine Sammeldatei.
- Der Vault-Name in der Konfiguration ist vorbelegt mit `Sy0sObsidian` (aus der Zustandskarte) und wird mit dem Zustand gespeichert.

## Dev-Lifecycle
Jeder Knoten kann einen Stand tragen: **Wartebereich → Test → Commit → Abgeschlossen** (Detailpanel). Ein Punkt darf nur Schritt für Schritt vorrücken, zurück geht immer. Nichts springt ungeprüft auf „Abgeschlossen“. Der Stand erscheint als farbige Hülle um den Knoten und als Punkt auf der Karte im Editor. Die Startwerte kommen aus dem Karten-Zweig „Dev-Lifecycle“. Es gibt Filter-Chips je Stand, und die Zahlen laufen in die Meilensteine ein.

## Verknüpfungen (3D)
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

## Trainingshub
Ast unter **Modelle** mit acht Lexikon-Einträgen rund ums ML-Training:
- **Standardvokabular:** Epoch, Batch, Iteration, Loss, Learning Rate — Epoch ist angelehnt an den YouTube-Short „What is an Epoch in Machine Learning?“, die übrigen ergänzen den Kontext.
- **Eigene SystemOS-Begriffe:** Darwin Loop (Trainingszyklus mit fest 7 Iterationen), Hybrid-Sync (erste Phase läuft synchron/blockierend) und Async (schließt direkt an Hybrid-Sync an, schaltet auf asynchrone Ausführung um).
- Darwin Loop → Iteration und Hybrid-Sync → Async sind als feste Verknüpfungen (siehe „Verknüpfungen“) vorverdrahtet, damit der Zusammenhang auch im 3D-View sichtbar ist.

## Zustand speichern
- **Zustand speichern** (Strg+S): Browser-Speicher (`localStorage`), wird beim nächsten Öffnen wiederhergestellt.
- **Export / Import:** dieselbe Momentaufnahme als JSON-Datei für den nächsten Schritt oder ein anderes Gerät.
- Gespeichert werden Startansicht, Durchsicht, Entzerren, Ebenen-Stufe, Node-Editor, Dev-Stände, Obsidian-Konfiguration, Governance-Anfragen, Filter, Verknüpfungen, aufgeklappte Knoten, verschobene Äste, angehängte Scans, Lexikon-Stand und Einstellungen.

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
