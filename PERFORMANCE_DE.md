# K1 DMR Web 0.1.1 – weniger Aussetzer bei USB und Audio

Die fertige `index.html` bleibt eine Einzeldatei. WebAssembly-Decoder, AMBE-Code und eingebetteter Selbsttest sind gegenüber dem Ausgangsstand unverändert. Änderungen betreffen Datentransport, Audiopufferung und Oberflächenarbeit.

## Änderungen

- USB-Empfang wartet nicht mehr auf eine Decoder-Worker-Antwort nach jedem gelesenen Block. Der Transport liest weiter; maximal eine Decoder-Batch wird gleichzeitig bearbeitet.
- Kleine Eingaben werden kurz gesammelt (12 ms), in Blöcken bis 8192 Bytes übertragen und mit ihrer Empfangszeit versehen. Das erhält die Reihenfolge und reduziert Worker-Nachrichten. Der Puffer ist auf 65536 Bytes begrenzt. Bei dauerhafter Überlastung wird mit Fehlermeldung getrennt, statt still Daten zu verwerfen.
- AudioWorklet mit festem Ringpuffer: 160 ms Anlaufpuffer gegen Jitter, anschließend laufende Ausgabe und kleine begrenzte Taktanpassung gegen Drift. Maximal 400 ms PCM-Rückstand; keine unbegrenzt wachsende Latenz. Slotwechsel und Trennen leeren den Audiopuffer.
- Audio-Pufferstand und Nachpufferungen erscheinen bei eingeschaltetem Ton. Auch ein normales Rufende kann als Nachpufferung gezählt werden; der Zähler allein beweist keinen USB-Fehler.
- Unveränderte Rufkarten werden nicht neu eingesetzt. Umfangreiche Diagnoseformatierung läuft nur bei aufgeklapptem Diagnosebereich. Große RadioID-Importe geben regelmäßig Rechenzeit an USB und Oberfläche zurück.

Die zusätzliche Anfangsverzögerung der Audioausgabe ist beabsichtigt. Sie tauscht etwas Latenz gegen stabilere Wiedergabe.

## Prüfung und Messwerte

`tests/results/validation.txt`, `audio.json` und `pipeline.json` dokumentieren die ausgeführten Tests. Ohne Browser- oder USB-Hardware, mit Node.js, echtem eingebettetem WebAssembly und synthetischen Daten:

- WebUSB/Serial-Konfiguration, DTR/RTS, Frequenzkommando und Schließen: bestanden.
- 140 kleine USB-Lesevorgänge werden in zwei Batches zusammengefasst; Bytefolge exakt erhalten. Eingaben werden auch bei absichtlich angehaltenem Decoder angenommen. Veraltete Bestätigungen können keine neue Verbindung freigeben. Überlastung wird erkannt.
- Worker-Vergleich mit derselben synthetischen K1-Aufnahme: vorher 2639 Nachrichten bei 64-Byte-Fragmentierung, nachher 43 bei 4096-Byte-Blöcken. Ein lokaler Lauf benötigte rund 260 ms gegenüber 113 ms. Das misst diesen fragmentierten Testfall und ist keine Zusage einer 2,3-fachen Gesamtbeschleunigung auf einem Telefon.
- Beide Slots: jeweils 72 AMBE-Rahmen und 11520 PCM-Samples; identische PCM-Energie vor/nach der Änderung. Keine vereinfachte Ersatz-Sprachsynthese.
- Audio-Simulation bei 44,1/48 kHz mit verzögerten, geordneten Paketen: nach dem Anlaufen keine zusätzlichen Nullsamples im gemessenen aktiven Intervall. Zwei Minuten simulierter Betrieb mit 0,1 % abweichendem Quelltakt: ebenfalls keine Lücken im gemessenen Intervall. Vorher gab es im Drift-Test 6464 zusätzliche Nullsamples.

Diese Tests ersetzen keinen Chrome-/Android-Test mit dem K1. Fehlerhafte RF-Symbole, USB-Paketverluste vor dem Browser, ein dauerhaft überforderter Prozessor und Hintergrund-Drosselung werden durch einen Jitterpuffer nicht behoben. Browser und Hardware wurden hier nicht live geprüft.

## Ausprobieren

Nach Übernahme der Änderung GitHub Pages neu laden (gegebenenfalls Strg+Umschalt+R). Unten muss **K1 DMR Web 0.1.1** stehen. K1 verbinden, Digi Bridge RAW starten und Ton einschalten. Beide Slots einzeln prüfen. Bei weiterem Hakeln Diagnosebereich aufklappen und Diagnose speichern; dort stehen zusätzlich Decoder-Zeit, Pufferstand und Überläufe. Entzerrer nur zum Vergleich abschalten, da das die RF-Decodierung verschlechtern kann.

## Tests und erneutes Packen

Keine npm-Pakete, kein Docker, keine Python-venv nötig. Node.js 18+ ist für Tests erforderlich:

```bash
bash PRUEFEN_PERFORMANZ.sh
```

Die lesbaren geänderten Quellen liegen in `src/`. Nach Änderungen lassen sie sich mit Python 3 erneut in dieselbe HTML-Datei einbetten:

```bash
python3 tools/pack-performance.py
bash PRUEFEN_PERFORMANZ.sh
```

Das Packen erhält den vorhandenen WASM-Code, Selbsttest und Lizenztext. Es kompiliert den C++-Decoder nicht neu.
