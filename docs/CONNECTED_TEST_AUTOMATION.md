# COS_C5: Verbundener Fall-Readback

Der lokale Runner prüft Regeln ohne Google-Dienste. Für einen **bereits durchgeführten synthetischen Personenfall** kann `scripts/check_connected_case.py` die gespeicherten Belege wiederholt über die vorhandene, eng begrenzte Archivberechtigung lesen:

```sh
python3 scripts/check_connected_case.py --case-id <private-case-id> --sheet-id <dedicated-sheet-id> --repeat 3
```

Der Checker verlangt die exakte Sheet-ID, prüft den dedizierten Eigentümer und liest nur Sheet- und Drive-Daten. Er vergleicht Auftrag, Personenfall, Sessions, zugeordnete Forms, angenommene Antworten, Zeitfolge, Proof, aktuelle Drive-PDF-Bytes, lokales Archiv, Receipt, Skill-Update und Matrixstand. Jede Wiederholung liest die Dienste erneut. Ein Unterschied zwischen den Snapshots oder ein fehlender Beleg macht den Lauf rot. JSON und Kurzbericht liegen privat unter `data/connected-checks/`; die Datei enthält keine OAuth-Tokens.

Der Bericht kennzeichnet sich als `connected_persisted_readback` und lässt `release_acceptance` auf `not_established`. Er führt keine neuen Testfälle, Form-Einreichungen, Mail-Sendungen, Deployments oder Google-Datenänderungen aus. Aktuelle Forms-`VERIFIED`-Einstellungen, Calendar-Events, der nummerierte `/exec`-Pfad und echte Rollenübergaben brauchen weiterhin eigene verbundene Beobachtungen. Der Checker ersetzt daher nicht die [integrierte Replay-Checkliste](product/DEMO_REPLAY_CHECKLIST.md).
