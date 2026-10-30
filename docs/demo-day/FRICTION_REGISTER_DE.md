# Reibungspunkte und Wiederanlauf

Stand: Quellcodeprüfung 29.10.2026. „Implementiert“ bezeichnet vorhandene Site-Logik; Geräte-, Hosting- und Zustellnachweise bleiben gesondert.

| Thema / Stand | Vorprüfung | Aktion | Erwartete Ansicht / Meldung | Wiederanlauf |
| --- | --- | --- | --- | --- |
| Rollen und Anmeldung · implementiert, Konfiguration prüfen | Zwei zugewiesene Konten; passende Rollenlinks | Raum öffnen | Nur passende Raumrolle darf handeln; Google-Token nötig, wenn eingerichtet | Konto und Rollenlink korrigieren; keine neue OAuth-Berechtigung während Vorführung |
| Linkverlust / Ablauf · implementierte Grenze | Beide Links sichern; 72-Stunden-Fenster | Neuladen / Raum erneut öffnen | Fehlender oder ungültiger Zugang wird abgewiesen | Im selben Browser das raumgebundene HttpOnly-Cookie nutzen; sonst gespeicherten Link verwenden; bei Verlust neuen Raum vorbereiten |
| Personenauswahl · implementiert | Matthew auswählen | Annina oder Marko einladen | „Für Annina und Marko ist noch kein Demo-Konto zugewiesen. Bitte Matthew wählen.“ | Matthew wählen; weitere Identitäten separat zuordnen (geplant) |
| Berechtigung · teilweise | Betriebliche Regeln nicht als Demo-Funktion zusagen | Thema und Zielniveau prüfen | Nur Themenliste, Matthew-Zuordnung und Ziel 1–3 geprüft | Vollständige Stufen-/Trainerqualifikation ist Produktarbeit |
| Termine · implementiert synthetisch | 1–3 gemeinsame freie Fenster der nächsten fünf Arbeitstage | Einladung erstellen | Nur beidseitig freie synthetische Kalenderfenster auswählen; Validierungsfehler bleiben sichtbar | Ein gemeinsames freies Fenster wählen; kein Google-Free/Busy behaupten |
| Geräteabgleich · implementiert | Netz und gleicher Raum | Matthew antwortet | Zustand nach nächstem Poll, normalerweise etwa 3 Sekunden später | Auf gespeicherten Stand warten, Verbindung prüfen; bei unklarem Ergebnis erst lesen, nicht blind wiederholen |
| Ein Angebot ablehnen · implementiert | Mindestens zwei Angebote | Erstes ablehnen | „Einen Vorschlag abgelehnt“ | Noch offenes zweites Angebot annehmen |
| Alle Angebote abgelehnt · implementierter Ausnahmezustand | Frischer Variantenfall | Alle ablehnen | „Alle Vorschläge abgelehnt“, Neuplanung nötig | Daniel ersetzt vor Trainingsbeginn 1–3 Angebote; Annahme wird zurückgesetzt, erneute Wahl nötig. Automatische Suche geplant |
| Mail · nur manueller Entwurf | Mailprogramm vorhanden; Vorschau auf Thema, Matthew, Angebote und Materialien prüfen | „E-Mail vorbereiten“ | Dynamischer Entwurf mit Portalaktion; konfigurierte Adresse vorbelegt, sonst manuell ergänzen | Sichere Linkübergabe; automatischer Versand fehlt. Kein Versand in dieser Dokumentationsarbeit |
| Erinnerung · In-App implementiert | Bestätigter Fall | Ablauf geöffnet lassen | „Erinnerung · Training geplant“ | Hinweis zeigen; automatische Mail und nativer Push geplant |
| Früher Start · implementiert | Bestätigter Termin | Starten | „Training gestartet“ im Verlauf | Nur Demozustand; keine Kalenderänderung |
| Absage · implementiert | Eingeladen, bestätigt, laufend oder Neuplanung | Daniel sagt ab | „Training abgesagt“ | Neuer Fall möglich; nach Bericht keine Absage über diese Aktion |
| Bericht · implementiert | Training gestartet | 5–1000 Zeichen und Ergebnis | „Trainerbericht erst nach dem Start möglich.“ oder Eingabehinweis bei Fehler | Zuerst starten bzw. Bericht korrigieren |
| Teilnahme fehlt · offener Zustand implementiert | Trainerbericht gespeichert | Matthew wartet | Fall bleibt vor persönlichem Abschluss | Teilnehmer bestätigt; automatische Mahnung/Eskalation geplant |
| Nicht bestanden · implementiert | Ergebnis „nicht bestanden“ | Teilnahme bestätigen | Kompetenzstufe bleibt; „Nachschulung nötig“ | Daniel legt Nachschulung manuell als neuen Fall an |
| Nachweise / Archiv · nicht in Site | Keine Belegdatei erwarten | Verlauf ansehen | Synthetischer Fallverlauf und bis 20 vorherige Fälle | Doc/PDF, Drive-/lokales Archiv und echte Matrixanbindung separat geplant |

Belegbasis: `shared-demo-site/lib/demo.ts`, `shared-demo-site/app/page.tsx`, `shared-demo-site/README.md`. Sicherheits- und Oberflächenänderungen anderer Arbeitsstränge können Beschriftungen präzisieren; vor dem Gespräch den lokalen Gerätestand gegenprüfen.

Bei verifizierter Traineranmeldung ist kein geteilter Startcode erforderlich. Die lokal unkonfigurierte synthetische Umgebung behält ihren Erstellungscode. Ein HttpOnly-Cookie ersetzt keine Google-Prüfung bei geschützten Requests.

Teilnehmerzugang: QR wird lokal erzeugt, ohne externen QR-Dienst. Web Share erscheint nur bei Browserunterstützung. Abgebrochenes Teilen ist kein Versandnachweis; Linkkopie bleibt der Wiederanlauf. Beide Varianten geben denselben privaten Teilnehmerzugang weiter.
