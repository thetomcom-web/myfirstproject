# 🎰 ROULETTE

Multiplayer-Roulette für einen Spieleabend: Ein Gerät (Fernseher, Laptop) ist der **Host** und zeigt Kessel, Tableau, Pot und alle Spieler. Alle anderen spielen am **Handy** mit und sehen dort nur ihre eigenen Einsätze – im selben WLAN oder von überall über das Internet.

> Nur zur Unterhaltung – gespielt wird ausschließlich mit Spielgeld.
> Glücksspiel um echtes Geld kann süchtig machen. Kostenlose Hilfe: BIÖG-Telefonberatung 0800 1 37 27 00.

## Funktionen

- Echte Roulette-Regeln: Plein, Cheval, Transversale, Carré, Sixain, Dutzend, Kolonne, Rot/Schwarz, Gerade/Ungerade, Manque/Passe
- Annoncen: Voisins du Zéro, Tiers, Orphelins, Jeu Zéro und Nachbarn
- Zwei Auszahlungsarten: **Pot aufteilen** (Pot wird unter den Gewinnern aufgeteilt, Jackpot bleibt liegen, wenn niemand trifft) oder **Klassisch** (feste Casino-Quoten)
- Host-Bildschirm im Querformat zeigt die Jetons aller Spieler mit Namen und Farbe
- 4 Sekunden Countdown nach dem Wurf, dann „Rien ne va plus“
- Beitreten per QR-Code, Link oder Raum-Code
- Läuft als reine Website (z. B. GitHub Pages) – kein eigener Server nötig

## Als Website auf GitHub Pages

1. Alle Dateien in ein GitHub-Repository hochladen (die Ordnerstruktur so lassen: `index.html`, `public/`, …).
2. Im Repository: **Settings → Pages → Branch: `main`, Ordner: `/ (root)` → Save**.
3. Nach ca. einer Minute ist das Spiel unter `https://<dein-name>.github.io/<repository>/` erreichbar.

## So wird gespielt

1. Am Fernseher/Laptop die Website öffnen, Namen eingeben und **Host** wählen.
2. In den ⚙︎ **Einstellungen** stehen QR-Code, Link und Raum-Code.
3. Freunde scannen den QR-Code oder öffnen den Link (z. B. per WhatsApp geschickt), geben ihren Namen ein und wählen **Spieler**. Ohne Link: Website öffnen, **Spieler** wählen und den Raum-Code eintippen.
4. Die Seite des Hosts muss während des Spiels geöffnet bleiben. Lädt sie neu, bleibt der Spielstand erhalten und alle Handys verbinden sich automatisch wieder.
5. **Spiel beenden** (in den Einstellungen) trennt alle Spieler und löscht den Spielstand.

## Lokal starten (ohne GitHub)

Voraussetzung: [Node.js](https://nodejs.org) ab Version 18.

- **Mac:** Doppelklick auf `Roulette starten.command` (beim ersten Mal ggf. Rechtsklick → Öffnen)
- **Windows:** Doppelklick auf `Roulette starten.bat`
- **Terminal:** `npm start`

Danach `http://localhost:3000` öffnen. Der QR-Code zeigt dann automatisch die WLAN-Adresse des Rechners.

## Wie funktioniert die Verbindung?

Der Browser des Hosts ist der Spielserver: Er berechnet alle Runden und Auszahlungen (`public/engine.js`) und speichert den Spielstand im Browser.
Host und Handys tauschen ihre Nachrichten über einen öffentlichen, kostenlosen Vermittlungs-Server aus (MQTT über sichere WebSockets – zuerst HiveMQ, bei Ausfall EMQX oder Mosquitto). Deshalb funktioniert es in jedem Netz, auch über Mobilfunk.

Hinweise:
- Host und Handys brauchen Internet.
- Über den Vermittlungs-Server laufen nur Spielname, Einsätze und Spielgeld-Stände. Bitte keine persönlichen Daten als Namen verwenden.
- Wer den Raum-Code oder Link kennt, kann mitspielen – also nur an Freunde schicken.

## Dateien

| Datei | Inhalt |
| --- | --- |
| `index.html` | Leitet auf das Spiel in `public/` weiter (für GitHub Pages) |
| `public/index.html` | Alle Bildschirme |
| `public/engine.js` | Spiel-Logik (läuft im Browser des Hosts) |
| `public/app.js` | Bedienung Host und Spieler, Verbindung |
| `public/shared.js` | Roulette-Regeln und Quoten |
| `public/table.js` | Tableau mit Jetons |
| `public/wheel.js` | Kessel mit Kugel |
| `public/style.css` | Design |
| `server.js` | Optional: kleiner lokaler Server zum Starten ohne GitHub |

---

<p align="center"><sub>a Tom Hilger production</sub></p>
