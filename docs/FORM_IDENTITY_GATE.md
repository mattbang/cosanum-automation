# Form email identity gate

Increment 14 adds a narrow REST adapter for trainer and participant Forms. `FormApp.setCollectEmail(true)` still builds each Form, then `FormsIdentity.gs` asks Google Forms for its current email collection mode. If needed, it sends `forms.batchUpdate` with `updateSettings.settings.emailCollectionType = VERIFIED` and `updateMask = emailCollectionType`. A separate `forms.get` must return `VERIFIED` before the Sheet row receives an automated verification timestamp. The existing `drive` scope covers the Forms methods; Apps Script also needs `script.external_request` for `UrlFetchApp`.

The existing `verified_at` and `verified_by` columns remain in place. Automated rows store `forms-api:<owner email>` in `verified_by`; historical owner-inspected rows retain the plain owner email. A repeated preparation reuses the same Form and row. API failure or a read-back mismatch leaves a new row pending for the established manual inspection. An API-marked row is read again before its responder link appears in the admin queue, a reminder can include the link, a response is accepted, or a person proof is built. A changed mode or failed read hides the link. A failed read during response processing leaves the raw Form response retryable rather than recording an accepted result.

Historical manual rows remain on the owner-reviewed path. They have no machine-readable history of later setting changes. Do not describe those rows as continuously verified. The adapter also cannot prove what the setting was at an earlier submission time if someone changes it away and back between reads.

## Connected acceptance still required

1. Grant the new `script.external_request` scope on the dedicated demo account after reviewing Google's consent screen. Confirm the Forms API is enabled for that script's Cloud project.
2. Create one new trainer Form and one new participant Form in the dedicated demo folder. Confirm both retain their original IDs on retry, both Sheet rows show the `forms-api:` actor, and `forms.get` returns `VERIFIED`.
3. Submit from each assigned signed-in test account. Confirm accepted response ID, account email, and time. Submit from a different signed-in account and confirm rejection.
4. Change a test Form to `RESPONDER_INPUT`. Confirm its link disappears and processing a new response cannot mark the case complete. Restore `VERIFIED`, then inspect the affected raw responses and audit trail before retrying.
5. Check that an API error leaves a new Form pending for manual review, and that a previously API-marked Form fails closed. Record the observed Cloud project, scopes, IDs, results, and side effects in the ignored private handoff.

This local implementation and its tests are not connected proof. See [Google Forms settings](https://developers.google.com/workspace/forms/api/reference/rest/v1/forms), [batch update](https://developers.google.com/workspace/forms/api/reference/rest/v1/forms/batchUpdate), and [Apps Script REST setup](https://developers.google.com/workspace/forms/api/guides/apps-script-setup).
