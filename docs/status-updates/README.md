# Cosanum Statusberichte

Diese drei Vorlagen sind die feste Grundlage für die Updates an die Projektgruppe. Sie verwenden dieselben Begriffe wie das Feature-Register im Projekt: *geplant*, *implementiert*, *lokal geprüft*, *bereitgestellt* und *verbunden abgenommen*. Eine Änderung zählt erst mit einem passenden Beleg. Das [Kanban](https://github.com/users/mattbang/projects/1) bleibt der Ort für Einzelaufgaben; die Berichte zeigen, was sich für das Produkt und die nächste Entscheidung geändert hat.

| Rhythmus | Vorlage | Zweck |
| --- | --- | --- |
| Täglich | [Tagesupdate](DAILY_TEMPLATE.md) | Veränderung seit dem letzten Arbeitstag und nächster Schritt |
| Wöchentlich | [Wochenupdate](WEEKLY_TEMPLATE.md) | Abgenommene Ergebnisse, offene Arbeit und Plan für die nächste Woche |
| Monatlich | [Monatsupdate](MONTHLY_TEMPLATE.md) | Produkttrend, Entscheidungen und Ausblick; enthält die strategische Sicht der früheren Quartalsvorlage |

## Fester Ablauf für jeden Rhythmus

1. **Erstellen:** Zeitraum festlegen. Feature-Register, Roadmap, Kanban, aktuelle PRs und private Übergaben vergleichen. Nur verifizierte Änderungen übernehmen; keine Prozentzahl oder Testkonten-/Fallzahl schätzen. Unveränderte Bereiche knapp als unverändert kennzeichnen.
2. **Auf GitHub archivieren:** Die fertige Fassung als datierte, nicht nachträglich überschriebene Datei unter `docs/status-updates/archive/YYYY/MM/` im Repository speichern. Dateinamen: `COS_A3_Tagesupdate_YYYY-MM-DD-r1.md`, `COS_A3_Wochenupdate_YYYY-Www-r1.md` oder `COS_A3_Monatsupdate_YYYY-MM-r1.md`. Bei Korrekturen die Revisionsnummer im Dateinamen erhöhen (`-r2`, `-r3` usw.) und auf die ersetzte Fassung verweisen. Im Kopf stehen Berichtszeitraum, Erstellungszeitpunkt und Quellenstand. Erst nach bestätigter Veröffentlichung auf dem Standardzweig ist der Bericht für einen Teams-Link bereit; ein lokaler Pfad oder eine offene PR genügt nicht. 
3. **Im Teams-Kanal veröffentlichen:** Eine kurze, lesbare Zusammenfassung mit dem bestätigten GitHub-Link zur Archivfassung als **neuen Beitrag** in `CAS PRDIG 26-2` → `Gruppe 5` (**Private**) posten. `Gruppe 5_Public` ist ein anderer Kanal. Vor dem Versand Zielkanal, Berechtigung und einen bereits vorhandenen Beitrag prüfen, damit bei Wiederholung kein Duplikat entsteht. Nach erfolgreichem Versand den Status und Zeitpunkt im [Veröffentlichungsprotokoll](POSTING_LOG.md) festhalten. Private Teams-Beitragslinks oder IDs nur in der privaten Übergabe aufbewahren. Wenn GitHub-Veröffentlichung oder Teams-Zugang fehlen, die Veröffentlichung als offen melden; keinen GitHub-Link oder Versand behaupten.

## Gestaltungsregeln

Helle Fläche, viel Weißraum und klare Typografie. Pflaume `#442545` für Titel, Flieder `#EEDFF0` für ruhige Flächen, Koralle `#FF6475` für wichtige Änderungen, Mint `#BFE8D5` für belegte Abnahmen und warmes Gelb `#FFE2A0` für offene Entscheidungen. In Markdown tragen kurze Rubriken und sparsame Symbole die Hierarchie; bei einem späteren PDF oder Web-Export dienen die Farben als Palette. Rot oder Grün allein darf keinen Status erklären.

Das Repository ist öffentlich. Private Übergaben nur intern zur Prüfung verwenden; keine privaten Pfade, Links, Asset-IDs oder personenbezogenen Testdaten in archivierte Berichte übernehmen. Für veröffentlichte Belege öffentliche Vorgänge oder bereinigte Zusammenfassungen nutzen. Testumfang nur als belegte Anzahl nennen; sonst `noch nicht verifiziert`. Die private Trainingsanwendung und die öffentliche synthetische Rollentour getrennt halten.

## Auf Anfrage

Wenn in ChatGPT ein Tages-, Wochen- oder Monatsupdate angefordert wird, dieselbe Vorlage und Reihenfolge verwenden: Bericht erstellen, auf GitHub archivieren, danach im festgelegten Teams-Kanal mit GitHub-Link posten. Den angefragten Zeitraum aus der Nachricht übernehmen. Ohne Angabe gilt beim Tagesbericht der heutige Tag bis zum Quellenstand, beim Wochenbericht die laufende Woche bis zum Quellenstand und beim Monatsbericht der letzte vollständig abgeschlossene Monat. Vorhandene Berichte nicht stillschweigend ersetzen.

Es laufen keine automatischen Tages-, Wochen- oder Monatsberichte. Die früher angelegten Zeitpläne sind pausiert.
