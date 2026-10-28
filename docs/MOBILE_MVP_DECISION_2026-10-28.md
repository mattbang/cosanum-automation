# Mobile MVP technical spike — 28 October 2026

## Observed local result

From merged `main` commit `4b60cfc`, the Android-first Expo SDK 54 app bundles for Android, iOS, and web. Expo Go on a local Android 37 emulator rendered the synthetic case list and booking screen; tapping a group booking moved both person cases to the shared synthetic event and displayed the trainer action. The 24 offline repository suites passed twice, and the mobile/server TypeScript checks and six focused tests passed. These are local and synthetic results. No iPhone device, assigned Google account, connected backend, actual PDF, notification, or deployment was tested.

## Option comparison

| Option | Fit for current tasks | Remaining work |
| --- | --- | --- |
| Responsive owner web plus Forms | Existing distribution path; #10 can test real Calendar and Form handoffs | Phone-sized connected replay and wrong-account checks; no installed experience |
| Installable web | Reuses web handoffs and may support a home-screen entry | Evaluate sign-in continuity, task links, push consent and offline behavior under #15 |
| Expo native app with web participant link | Local operator screens and synthetic person-level group behavior work on Android; web link avoids participant install | Connected server identity/evidence API, device distribution, role-specific observations, update and support ownership |

Recommendation: use the Expo prototype for the synthetic operator pilot while keeping the existing owner-only web path as the connected baseline. Decide on distribution only after the prerequisites below are observed. The current spike does not justify a maintenance or cost estimate from measured data.

## Pilot gates and linked cards

- [#10](https://github.com/mattbang/cosanum-automation/issues/10): complete the existing owner web, Google Form, and Calendar phone checks on the exact deployed version. The emulator result above does not close this card.
- [#11](https://github.com/mattbang/cosanum-automation/issues/11): a task link must resolve to the current assigned person and be rejected after completion, cancellation, or wrong-account opening. The prototype's `canExecute: false` projection and server boundary are a starting point; live links remain open.
- [#12](https://github.com/mattbang/cosanum-automation/issues/12): observe booking, trainer, participant, and exception screens with the three demo roles on phones. The synthetic UI has one prominent action in the current case but has no observed role study or persisted outcome.
- [#23](https://github.com/mattbang/cosanum-automation/issues/23): compare this spike with responsive and installable web after the above tests, then record the distribution and operational decision. This document is the initial comparison, not a final go decision.

Go for a connected pilot only when the dedicated server has verified identity and exact role assignment, all write actions re-read current evidence and read back their results, wrong-account and stale-link tests fail closed, the owner-only deployment remains restricted, and both Android and iPhone journeys are observed with recorded device and version details. Otherwise keep the prototype local and synthetic.
