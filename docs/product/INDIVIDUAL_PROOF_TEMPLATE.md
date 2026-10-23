# Individual training proof template [DEMO]

Generate **one Google Doc and PDF per person case** after trainer pass and accepted participant acknowledgement for every required phase. The proof is a summary of retained source responses. Keep the Doc and PDF versioned; a correction makes a new version and preserves the old one. The layout should fit on one readable page when possible.

```text
SCHULUNGSNACHWEIS [DEMO]                         Nachweis {{proof_id}} · Version {{proof_version}}

Person                     {{person_name}}
Verifiziertes Google-Konto {{verified_participant_email}}
Thema / Themen-ID          {{topic_name}} / {{topic_id}}
Material / Version         {{material_name}} / {{material_version}}
Auftrag / Fall             {{request_id}} / {{case_id}}
Erforderliche Phasen       {{phase_count}}

TERMINE UND BEURTEILUNGEN (eine Zeile je erforderlicher Phase)
{{phase_rows}}
Je Zeile: Phase · Termin-ID · Beginn/Ende Europe/Zurich · Ort · schulende Person
          · anwesend · bestanden · Trainerantwort-ID/Zeit · Admin-Quellenlink

PERSÖNLICHE BESTÄTIGUNGEN (eine Zeile je erforderlicher Phase)
{{acknowledgement_rows}}
Je Zeile: Termin-ID · Ja, Teilnahme bestätigt · eingegebener Name
          · verifiziertes Konto · Antwort-ID/Zeit · Admin-Quellenlink

SKILL-ZIEL IM DEMO
Vorherige Stufe            {{previous_level}}
Konfigurierte Zielstufe    {{target_level}}
Hinweis                    Die Zielstufe ist hier dokumentiert; ihre spätere
                           Eintragung erfolgt erst nach Prüfung beider Archive.

QUELLEN UND ERSTELLUNG
Kalendertermine            {{calendar_event_admin_urls}}
Erstellt                   {{created_at_utc}}
Dokumentstatus             Nachweis erstellt; Archiv- und Skillstatus stehen
                           im Fallregister und im Archivmanifest.

Dieser DEMO-Nachweis bescheinigt keine reale Qualifikation.
```

## Generation gate

Require the assigned trainer's verified, attended + passed result and the correct participant's accepted affirmative response for **every required phase**. Theory must pass before the practice phase can support the target. Validate stable IDs and source times before rendering. Keep the raw Form responses and Calendar events as linked records; the admin links should open read-only evidence views, not respondent edit URLs. Do not print `Archiv geprüft` or `Skillstufe eingetragen` into the initial proof: those operations occur **after** PDF creation and could otherwise make the document falsely claim a future state. The [archive manifest](ARCHIVE_MANIFEST.example.json) records the matching PDF hash and verification; the skill ledger records the actual applied level.
