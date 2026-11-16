# LINE receiving group — repaired parsing and safe backfill (16 Nov 2026)

## Current behavior

- LINE group: `C79f1da0c3566121949e6e05fcefa09bd`, **แจ้งปัญหาการรับสินค้า สุกี้ตี๋น้อย**. WHservice is already a member; no new bot or webhook is required.
- Webhook v29 recognizes exact evidence such as:
  - สาขาเดอะสตรีทรัชดา / เนื้อวัวออสเตรเลีย 3.3 กก. / ได้รับจริง128.4กก. / ในระบบ131.7กก.
  - Separate product line without a list marker, followed by actual and in-system weights.
- **Business rule:** any receiving shortage is an issue; an overage strictly above 3% of the ordered/reference quantity is an issue. The 3% boundary is acceptable. Weighted shortages must be labeled **น้ำหนักชั่งขาด**.
- For texts using **ในระบบ**, `ordered_qty` contains the **in-system reference**, which may not be the original order; `reported_action` includes **เทียบกับยอดในระบบ** to preserve provenance. Inspect the source when comparing to PO.
- If the reported difference doesn't match the actual-vs-system calculation, don't store an invented number; flag the message for human review.
- Bare `ยอดสั่ง` lines are not a product; the parser must not create items named `ยอด`.

## Verification

- 15 parser regression tests passed in local Node TypeScript test runner and in GitHub CI.
- Historical reparse scanned 91 preserved receiving-text messages; 6 confidently parsed missing items inserted idempotently; no duplicates and no synthetic incidents.
- Two source messages from the screenshot now correspond to -3.3kg and -3.6kg shortages. Receiving-group issues increased from 16 to 22.
- Receiving review queue previously held 35 items and remains available for human confirmation.
- Postgres policy check changed from obsolete +/-3kg to any shortage / >3% overage. Check constraint is **NOT VALID for historical rows** because one earlier row under the old rule is within the new 3% overage allowance. New inserts/updates are validated under the new rule; historical discrepancy awaits an explicit audit decision, not an automatic deletion.
- Teams daily-report text updated to the same policy; authenticated read-only preview for 2026-11-15 returned Receiving 1 and Quality 34, including the branch in the source screenshot. Preview did not send a new Teams card or modify a prior SENT dispatch.

## Operations

- Google Sheets `ISSUES`/`BRANCH_DAILY` use the existing 15-minute Apps Script sync against the Supabase export endpoint. Don't reinstall a trigger.
- The Teams report scheduled at 08:00 Bangkok groups incidents by **message receipt date**. A previously SENT date remains SENT; historical backfill does **not** automatically resend it.
- Keep `line_message_id + line_item_index` unique and reconcile old records before any broad replays. Do not execute a second historical backfill without verifying the prior inserts.

## Google Sheets sync fix (same day)

- The current live Apps Script, pulled using authenticated `clasp`, already supported reported-only receiving rows, but still rejected +/-3kg tolerance rows. This could abort the entire mirror update.
- Patched live script to apply zero shortage / 3% overage rules, skip the one historical policy-accepted overage with a warning rather than fail the whole sync, and keep reported-only NOT_RECEIVED / INCOMPLETE_RECEIPT rows.
- `ISSUES`, `BRANCH_DAILY`, and `GROUP_DAILY` must count only reportable rows consistently; source records remain in Supabase and can be audited.
- Added pure policy regression tests (4 passed) in `apps-script/receiving-policy.test.mjs` and CI. Pushed through `clasp` and pulled again to confirm exact live source match; reused existing 15-minute trigger. Manual `clasp run` requires execution API support and returned `NOT_FOUND`; scheduled trigger remains the live sync mechanism.
