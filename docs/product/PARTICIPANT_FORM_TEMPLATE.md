# Participant acknowledgement Form template [DEMO]

**Form title:** `[DEMO] Teilnahmebestätigung – {{topic_name}}`
**Audience:** one assigned participant for one person/session case, after the trainer has recorded attended + passed. The link is sent using the [acknowledgement email template](../NOTIFICATION_TEMPLATES.md).

## Responder view in German

```text
Teilnahmebestätigung [DEMO]
Thema: {{topic_name}} · Teil: {{phase_label}}
Termin: {{training_start_local}}–{{training_end_local}} Europe/Zurich
Schulende Person: {{trainer_name}}
Auftrag: {{request_id}} · Termin: {{session_id}}

Bitte bestätigen Sie nur Ihre eigene Teilnahme. Wenn Sie nicht teilgenommen
haben oder die Angaben nicht stimmen, senden Sie das Formular nicht ab.
Antworten Sie stattdessen auf die E-Mail mit dem Link.

1. Teilnahmebestätigung *
   [ ] Ich bestätige, dass ich an der oben genannten Schulung teilgenommen habe.

2. Vor- und Nachname *
   [Textfeld]

Absenden
```

**Confirmation message:** `Ihre Teilnahmebestätigung für diesen DEMO-Termin wurde übermittelt. Sie wird erst nach Prüfung Ihres Google-Kontos dem richtigen Fall zugeordnet.`

## Acceptance and audit data

- Set Google Forms email collection to **Verified** and use the published responder URL. The participant confirms collection of their signed-in Google account. A typed email question is not a substitute.
- Capture `response_id`, verified respondent email, submitted timestamp, typed name, affirmative answer, and request/session/case IDs. The respondent email must match the assigned `People.email`; the form IDs and session must match the current person case. Treat prefilled answers as editable input.
- The checkbox must be affirmative. No response, wrong account, wrong session, or duplicate response leaves the case open and creates a visible audit reason. Do not create a proof or raise a skill level for these attempts.
- This is a demo electronic acknowledgement, not a qualified electronic signature. Wording and identity standard need P&Q/QM review before any production use.
