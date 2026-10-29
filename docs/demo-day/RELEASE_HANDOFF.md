# Demo-day delivery · 29 October 2026

Public shared Site: https://cosanum-shared-training-demo.mattbangle.chatgpt.site
Presentation: https://cosanum-shared-training-demo.mattbangle.chatgpt.site/presentation/index.html

Sites **version 6** deployed successfully. Source commit: `f306020d1389fc0a805e2c9151bb880be740271f`; deployment: `appgdep_6ae349a137a481918da399b22a44e083`. Public audience preserved. No private original training/employee files were published.

Implemented: Daniel request overview with persisted synthetic requester/deadline, individual planning, next-five-working-day shared availability, one to three offers, rejection and reacceptance after rescheduling, early start, cancellation, trainer report, explicit participant acknowledgement, per-person skill change/history, preparation materials, roster, source downloads, local invitation QR/Web Share and populated manual email draft. Plum/lilac/coral restored.

Access: configured Google mode requires the exact trainer account to create a room without a separate start code. Both room roles still require exact assigned verified identity and a valid role capability. An HttpOnly, Secure, SameSite=Strict room cookie supports reload in the same browser. New browsers require the original personal link. Credentials are not stored in browser storage. One role per room per browser cookie: use two devices/separate browser profiles, not two accounts sharing one browser profile.

Validation: 12 unit checks passed, TypeScript and production build passed. Loopback API rehearsal passed role/cookie recovery, wrong-role report denial, reject/accept/reschedule/reaccept/early-start/report/confirm, and person-specific skill update. Browser QA at 390px confirmed calendar layout and reload recovery. Live presentation/material/source routes return 200; unauthenticated room creation returns 401; configured Google mode reports no creation-code requirement. New Google sign-in could not be completed through the automation browser iframe; the post-deployment assigned-account two-phone check remains required. Earlier sign-in acceptance must not be represented as this version's full two-device acceptance.

BPMN: one connected lifecycle with three responsibility lanes plus scenario appendix. OMG schema, reference/graph/lane/DI/grid checks and bpmn-js import passed. ADONIS-native import remains unverified. See MODEL_NOTES.md and validation-receipt.json.

Real Google free/busy/event operations, automatic email delivery, remote push, live employee registry, real Drive/Sheets exchange and archival proof remain separate unconnected capabilities. Source CSVs show fictitious baseline snapshots; D1 stores shared room outcomes. The Drive connector currently belongs to the private account, so no files were created there. A dedicated-account Drive folder/Sheets setup remains a gate.

Android build 3 was prepared by the mobile task from commit `0f56f93`: embedded bundle, emulator install/cold start, 15 mobile tests, TypeScript/lint/Gradle passed. Shared workflow opens the system browser. iOS Expo export and simulator Safari reachability passed; native iPhone installation remains an Apple signing gate. No signed iPhone build exists from this delivery.
