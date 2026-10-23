# Trainer report Form template [DEMO]

**Form title:** `[DEMO] Schulungsbeurteilung – {{topic_name}}`
**Audience:** the assigned trainer only. After the session, send one [trainer-report email](../NOTIFICATION_TEMPLATES.md) per person case with that case's Form link. For a group, collect **one response per session/person case**. This keeps each result, timestamp, and correction traceable without granting Sheet access.

## Responder view in German

```text
Schulungsbeurteilung [DEMO]
Thema: {{topic_name}} · Teil: {{phase_label}}
Termin: {{training_start_local}}–{{training_end_local}} Europe/Zurich
Teilnehmende Person: {{person_name}}
Auftrag: {{request_id}} · Termin: {{session_id}}

1. War die Person bei diesem Schulungsteil anwesend? *
   ( ) Ja, anwesend   ( ) Nein, abwesend

2. Wie beurteilen Sie das Ergebnis dieses Schulungsteils? *
   ( ) Bestanden   ( ) Nachschulung nötig   ( ) Nicht beurteilt

3. Bemerkung / nächster Schritt
   [Freitext; bei Abwesenheit, Nachschulung oder fehlender Beurteilung Pflicht]

4. Ich bestätige, dass ich diese Angaben für die oben genannte Person
   und diesen Termin gemacht habe. *  [ ] Ja

Absenden
```

**Confirmation message:** `Ihre Beurteilung wurde für diesen DEMO-Fall erfasst. Korrekturen melden Sie bitte an Daniel unter Angabe der Auftrags- und Termin-ID.`

## Values captured outside the visible questions

| Value | Source | Validation |
| --- | --- | --- |
| Verified trainer email | Google Forms verified email collection | Must match the trainer assigned to this session; typed names or prefilled values are not identity proof. |
| Response ID and timestamp | FormResponse | Store raw ID and UTC time once; retain rejected/duplicate attempts in the audit trail. |
| `request_id`, `session_id`, `case_id`, `person_key`, `phase` | Registered link context or prefilled fields | Re-read register and verify all IDs match. Prefilled fields can be edited and are untrusted. |
| Attendance, result, note, attestation | Form answers | `passed` is valid only with `attended`; absent/needs follow-up/not assessed remain open. A missing note on a non-pass is rejected or sent back for correction. |

The trainer result is a sign-off for the configured phase, not automatic completion of the request. Where theory precedes practice, practice cannot confer the target level until theory passed. A second response must be handled as an explicit assessment revision or rejected; it must not create two competing current results.
