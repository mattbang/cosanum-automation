# Quellen und Datenfluss

Stand 29.10.2026 · öffentliche Demo enthält nur synthetische Daten. Dieses Register beschreibt Herkunft und Zuständigkeit, keine Freigabe produktiver Daten.

| Quelle | Heute in der gemeinsamen Site | Führender Stand / Zugriff | Fehlende Verbindung und Zielbild |
| --- | --- | --- | --- |
| Mitarbeitende | Matthew, Annina, Marko aus `lib/demo.ts`; nur Matthew zugewiesen | Synthetischer Quellcode; Raumrolle serverseitig prüfen | Produktiver Personalstamm, Eintritt/Austritt und weitere Kontenzuordnung geplant |
| Schulungskatalog | Vier feste Themen aus `lib/demo.ts`, Lernpakete aus `lib/materials.ts` | Öffentliche, neu erstellte Demo-Unterlagen | Freigegebener Themenkatalog mit Verantwortlichen und Versionen geplant |
| Materialordner | Synthetisches Kurzmaterial und Vorbereitungsblatt im öffentlichen Site-Bestand | Links des Demo-Katalogs; keine privaten Originale | Betrieblicher Drive-Ordner mit Zugriffsrechten und freigegebenen Arbeitsanweisungen geplant |
| Kompetenzmatrix | Fiktiver Ausgangsstand; bestandener, persönlich bestätigter Fall aktualisiert Raumzustand | Synthetische D1-Raumdaten; kein Google-Sheet-Schreibzugriff | Produktive Matrix mit Versions-/Konfliktprüfung und Nachweisbindung geplant |
| Workflow und Audit | Angebote, Antworten, Start, Absage, Bericht, Bestätigung; gemeinsamer Verlauf | Cloud-D1-Raumzustand; beide Geräte lesen etwa alle 3 Sekunden | Kein revisionssicheres Audit, keine Doc/PDF-Belege oder verifizierten Archivkopien |
| Kalender | Synthetische Frei-/Belegt-Fenster von Daniel und Matthew für die nächsten fünf Arbeitstage | Gemeinsam freie Demo-Fenster, Zürich-Zeit/DST und Wochenende berücksichtigt; keine Google-Free/Busy-Abfrage oder Ereignisbuchung | Zugeordnete Google-Kalender, Verfügbarkeitsprüfung und Buchungsreadback geplant |
| Externe Anfragen | Keine automatische Übernahme | Bedarf wird durch Daniel eingegeben | Anfragen aus Änderungen, Qualität oder weiteren Kanälen mit Herkunft, Prüfung und Dublettenschutz geplant |
| Identität | Google-ID-Token-Verifikation sofern eingerichtet, zusätzlich Rollenlink | Serverseitige Konto-/Rollenzuordnung; keine Kontoadressen im öffentlichen Register | Laufende Kontenprüfung nötig; Anmeldung ist keine Calendar-/Mail-/Drive-Integration |
| Nachrichten | Dynamischer manueller Mailentwurf (Thema/Teilnehmer, Angebote, Material und Portalaktion), lokaler QR/Web Share und Hinweis im geöffneten Ablauf | Mailprogramm des Vorführenden / Site-Ansicht | Automatische Mailzustellung, Versandledger und nativer Push fehlen |

Die private Apps-Script-Anwendung ist ein eigener Arbeitsstrang. Ihre dokumentierten Google-Einzelprüfungen übertragen sich nicht auf diese Site. Es wurden keine privaten Originaldateien in das Präsentationspaket übernommen.

## Spaltenzuordnung für getrennte Zielquellen

Die drei öffentlichen CSV-Endpunkte sind synthetische Cloud-Dateien, keine verbundenen Google Sheets. `/api/sources` liefert Metadaten; `/api/sources/employees`, `/api/sources/catalogue` und `/api/sources/matrix` liefern CSV. `/materials/index.html` erschliesst die neuen Demo-Unterlagen. Die Matrix-CSV zeigt den fiktiven Ausgangsstand; die dynamische Raum-Matrix muss im Raum geprüft werden.

| Bestehendes Schema (`apps-script/Schema.gs`) | Getrennte Zielquelle / Übernahmeplan | Heutige Site-CSV |
| --- | --- | --- |
| People: `person_key`, `display_alias`, `demo_role`, `persona_id`, `email`, `demo_marker` | Personalregister: stabile ID, Name, Rolle; Konto-/E-Mail-Zuordnung geschützt separat, nie öffentlich exportieren | `employee_id`, `name`, `role`, `account_status`, `synthetic`; keine echte E-Mail |
| Topics: `topic_id`, `display_name`, `configured_target_level`, `progression_rule` | Katalog: ID, Titel, Zielniveau, Stufenregel mit Version | `topic_id`, `topic`, `version`; Zielniveau/Regeln fehlen in CSV |
| Topics: `theory_required`, `practice_required`, `theory_minutes`, `practice_minutes`, `group_suitability` | Katalog: getrennte Theorie-/Praxisphasen, Dauer und Gruppeneignung; kein pauschales Zusammenwerfen | CSV hat nur `duration_minutes` (60 Demo-Minuten); keine gleichwertige Phasenabbildung |
| Topics: `source_material` | Versionierter Materialordner; Katalog speichert freigegebenen Materialverweis | `material_folder`; nur synthetischer Site-Ordner |
| Skills: `person_key`, `topic_id`, `skill_level`, `status_mark`, `demo_marker` | Eigene Kompetenzmatrix: Personen-/Themen-Fremdschlüssel, Stufe, Status; künftige Konflikt-/Versionsprüfung | `employee_id`, `topic_id`, `topic`, `level`, `status`, `synthetic` |
| Requests, ParticipantCases, Sessions, SessionCases, SessionRsvps | Transaktionale Workflow-Datenbank; Anfrage, Person, Phase, Buchung und Antwort getrennt | D1-Raumfall ist vereinfachte Demo; keine vollständige Tabellenmigration |
| TrainerAssessments, ParticipantAcknowledgements, Proofs, ArchiveReceipts, SkillUpdates, MessageLedger, FollowUps | Audit-/Nachweisregister mit Quellenreferenzen, Identität und unveränderbarer Ereignisfolge | Site zeigt Bericht/Bestätigung/Verlauf; keine gleichwertige Beleg- oder Zustellkette |

Die private Anwendung nutzt fünf festgelegte Themen-IDs und Theorie-/Praxisflags; die Site nutzt vier eigene `TR-*`-Themen. Ein Import braucht eine geprüfte Zuordnung, keine Gleichsetzung nach ähnlichem Namen. Ein eigener fachlicher Schulungstyp kann künftig ergänzt werden; derzeit sind Thema, Phasenpflicht und Gruppeneignung die belegten Felder.

Vor Drive-/Sheets-Anbindung das dedizierte Demokonto, Zielordner und Rechte prüfen. Der derzeit verfügbare primäre private Gmail-/Drive-Connector ist kein freigegebenes Schreibziel für diese Integration. Dieser Plan führt keine verbundenen Schreibvorgänge aus.
