# K1 DMR Web 0.1.2 – direkter Audiokanal

Die Rückmeldung zu 0.1.1 war: besser, aber weiterhin Aussetzer. Eine weitere Engstelle war im Audioweg vorhanden: Der Decoder-Worker lieferte PCM an den Hauptthread, und erst dieser leitete es zum AudioWorklet weiter. Das machte die Audiozufuhr unnötig vom Hauptthread abhängig.

## Änderung

PCM läuft jetzt über einen eigenen MessageChannel direkt vom Decoder-Worker zum AudioWorklet. Slotwahl, automatische Auswahl und Stummschaltung werden im Worker angewendet. Der Hauptthread bekommt nur Statusmeldungen. Er muss die Sprachblöcke nicht mehr weiterreichen.

Der Audiopuffer ist wählbar:

- 160 ms: kurze Verzögerung.
- 320 ms: Standard, mehr Reserve gegen ungleichmäßigen Nachschub.
- 480 ms: zusätzliche Reserve zum Vergleich.

Der Ringpuffer bleibt begrenzt: Zielgröße plus höchstens 240 ms Reserve. Eine höhere Puffergröße erhöht die Empfangsverzögerung. Die Wahl bleibt lokal gespeichert. AudioContext nutzt den Hinweis `playback`, damit der Browser eine robuste Ausgabe bevorzugen kann.

Der Audio-Status zeigt `Direktaudio`, den aktuellen/Ziel-Pufferstand und die Nachpufferungen. Die gespeicherte Diagnose enthält auch `directAudio`, `targetMs`, `bufferMs`, `underruns` und `overflows`. Normale Rufenden können ebenfalls Nachpufferungen auslösen; ein einzelner Zähler ist kein Beweis für verlorene Funkpakete.

## Geprüft

`tests/results/validation-0.1.2.txt` und `direct-audio.json` enthalten die Tests:

- Echter eingebetteter WASM-Decoder auf einem separaten Thread, ausgelieferter AudioWorklet-Code auf einem zweiten Thread.
- Hauptthread absichtlich 450 ms blockiert. Ausgewähltes TS1-Audio kam währenddessen nach rund 30 ms auf dem Audio-Thread an. Dieser erzeugte weiterhin nichtleere Audioausgabe. Der Hauptthread erhielt keine weiterzuleitenden PCM-Nachrichten.
- TS2-Auswahl und Stummschaltung nach einem Decoder-Reset geprüft.
- USB-Konfiguration, exakte Bytefolge, Puffergrenze, Sessionwechsel sowie Jitter-/Takttests weiterhin bestanden.
- Beide DMR-Slots weiterhin mit insgesamt 144 AMBE-Rahmen und unveränderten PCM-Ergebnissen. Decoder-WASM und eingebettetes Testsignal sind unverändert.

Dies ist ein Thread-/Softwaretest unter Node.js, kein Chrome-/Hardware-Livetest. Ein blockierter Hauptthread kann weiterhin den dort laufenden USB-Lesecode verzögern. Der direkte Audiokanal schützt bereits decodierten Ton, ersetzt aber keine fehlenden Funk- oder USB-Daten.

## Ausprobieren und verbleibende Aussetzer zuordnen

0.1.2 laden, unten die Versionsnummer kontrollieren, zunächst **320 ms** wählen und den gewünschten Zeitschlitz fest einstellen. Erst dann mit automatischer Slotwahl vergleichen.

Wenn es weiter hakelt, während eines Durchgangs den Diagnosebereich öffnen und **Diagnose speichern** drücken. Benötigt werden diese JSON-Datei und die Angabe, ob der Empfang unter Linux/Chrome oder Android läuft. Die vorhandenen USB-Lücken, AMBE-Fehler/Stummschaltungen und die neuen Audiopuffer-Zähler helfen bei der Zuordnung. Ohne diesen Mitschnitt lässt sich nicht feststellen, welche der verbleibenden Ursachen auf dem Gerät auftritt.

Tests: `bash PRUEFEN_PERFORMANZ.sh`. Nach Änderungen an den lesbaren JS-Quellen: `python3 tools/pack-performance.py`.
