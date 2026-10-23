# Calendar event template [DEMO]

**One event per session phase.** A group session may have several participants; theory and practice remain separate linked sessions. Google Calendar sends the invitation when the booking is created with guest updates enabled. Do not send a second custom invitation email.

## Guest-visible event

```text
Title: [DEMO] Schulung: {{topic_name}} · {{phase_label}}
When: {{start_local}}–{{end_local}} Europe/Zurich
Where: {{location_or_online_details}}

Schulungsthema: {{topic_name}}
Teil: {{phase_label}} ({{duration_minutes}} Minuten)
Schulende Person: {{trainer_name}}
Material: {{material_url_or_not_provided}}

Bitte beantworten Sie die Kalendereinladung. Wenn Sie nicht teilnehmen können,
lehnen Sie ab; Daniel klärt einen Ersatztermin.

Auftrag: {{request_id}} · Termin: {{session_id}} [DEMO]
```

Only include a material link when every invitee has access. Do not list skill levels, assessment results, other participants, or evidence links in the event description.

## Data mapping and acceptance

| Calendar field | Source and rule |
| --- | --- |
| `summary`, `description` | Render the guest text above with validated display values. |
| `start.dateTime`, `end.dateTime`, `timeZone` | Exact selected proposal after a fresh free/busy check; `Europe/Zurich`, with an RFC 3339 offset for the actual date. |
| `attendees` | Assigned trainer and participants from the register; deduplicate an address that has two roles. |
| `location` | Only if Daniel entered a real room or meeting location for the demo. |
| guest updates | Send to all invited guests on creation; keep one event ID in the session register for retries. |
| guest visibility | Default to not showing the guest list to other guests unless the demo explicitly needs it. |

On conflict or per-calendar access error, create no event. A declined participant remains an open person case; the group event stays booked for others. An unanswered RSVP is a pre-session flag, not an absence mark. A replacement session gets a new `session_id` linked to the original case and must not overwrite the original event history.
