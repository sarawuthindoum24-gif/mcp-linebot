# BNN Receiving Issue Bot — Supabase-first (Draft)

**Status:** DRAFT / NOT DEPLOYED. This feature is new and isolated. It does not modify the pre-existing `LINE-01-Webhook-Collector` or `LINE-02-Text-Receiving-Processor` pipeline, whose separate approval gates still apply.

## Business logic

1. Receive text messages from LINE group/room using a signed Messaging API webhook.
2. Verify the `x-line-signature` HMAC-SHA256 against the **channel secret** and the unchanged raw HTTP body before parsing.
3. Detect branch name, issue date, and individual product lines.
4. Calculate `received_qty - ordered_qty` from actual quantities. Positive = OVER, negative = SHORT.
5. **Do not store weighted lines whose absolute difference is at most 5.000 kg (including exactly 5.000 kg).** Grams are converted to kilograms; counted goods are not subject to this threshold.
6. Store eligible product items only in Supabase PostgreSQL. Neither rejected raw lines nor complete LINE raw message payloads are stored by this new bot.
7. Collect only minimal `line_message_id` metadata for unparsed-item review; no raw text.
8. On LINE unsend, mark matched stored items void (do not delete audit history).
9. At 08:00 Bangkok time, summarize **messages received on the previous Bangkok calendar day** and post a single grouped report to the Microsoft Teams channel `รายสาขา`.
10. Google Sheets is a **secondary reporting/mirror destination**, not the system of record. Its automatic synchronization is not yet implemented in this draft.

## Example acceptance

- Branch จตุจักรชลบุรี; ปลาหมึกกรอบ ordered 25 kg, actual 30 kg → +5 kg → **not stored**
- Same branch; ปลาหมึกสด ordered 30 kg, actual 25 kg → −5 kg → **not stored**
- 6 kg / −6 kg → stored.
- Two units short (`ชิ้น`) → stored.
- Missing unit or other ambiguous fields → safe needs-review marker, not an invented quantity.

## Configuration (never commit tokens)

1. Connect a separate staging **Supabase** project and review/apply `supabase/migrations/20261020_receiving_issues.sql`.
2. Configure **Supabase Edge Function secrets**:
   - `LINE_CHANNEL_SECRET`: from LINE Developers > Basic settings (NOT the channel access token).
   - `SUPABASE_URL`: project API URL (normally available to Edge Functions).
   - `SUPABASE_SERVICE_ROLE_KEY`: server-side key (normally available to Edge Functions; never use in a browser).
   - `TEAMS_WEBHOOK_URL`: Teams Workflows incoming-webhook URL for channel `รายสาขา`.
   - `DAILY_REPORT_SECRET`: generate an independent strong random string; match GitHub secret below.
3. Configure **GitHub repository secrets** (Actions):
   - `SUPABASE_ACCESS_TOKEN` (Supabase Management API/CLI PAT; not LINE channel token).
   - `SUPABASE_PROJECT_REF`.
   - `DAILY_REPORT_SECRET`.
4. Configure **GitHub repository variables** (Actions):
   - `RECEIVING_BOT_DEPLOY_APPROVED=true` only after SQL/schema/signature/test sign-off.
   - `RECEIVING_BOT_DAILY_ENABLED=true` only after controlled pilot approval and verified Teams destination.
5. After approval, run the **manual** workflow `Deploy Receiving Bot Edge Functions (manual)`. It deploys functions only; the migration must already have been applied.
6. Point the LINE Messaging API webhook to `https://<project-ref>.supabase.co/functions/v1/line-webhook`. Keep verification enabled and ensure no other collector is unintentionally displaced.
7. Invite the OA to the actual LINE group, grant the bot group participation permission in LINE Developers, and run a **synthetic** signed webhook test. Do not test using real branch stock adjustments.
8. Set up Teams Workflows webhook for the correct team/channel. Test a card delivery and consent/permissions.
9. Enable daily workflow after a signed-off pilot. GitHub scheduled workflows run on the repository default branch, at 01:00 UTC (08:00 Bangkok), and can execute later than their nominal time.

## Run tests

```bash
deno test supabase/functions/_shared/parser_test.ts
```

## Important caveats

- The parser intentionally supports **only explicit order-and-actual quantity text lines with units**. Other wording is flagged for review. No OCR, image inspection, AI guesses, adjustment of SAP/POS stock, or automatic return/claim handling.
- Direct LINE webhook deployment requires a dedicated webhook URL and the LINE **channel secret**. A previously posted long-lived channel **access token must be revoked and regenerated**; it is not needed for signature verification and is deliberately absent from this repository.
- If LINE sends `unsend`, the source message is invalidated by setting `is_void` on stored rows. An unsend delivered ahead of the original source message is a follow-up enhancement before production.
- Messages cannot be sent to Teams or written to Supabase until the connectors are configured; the repository alone does not create a Supabase project, schema, or live connection.
- Daily report dispatches are claimed before Teams delivery. When a request fails or has uncertain remote status, it is marked FAILED and **not automatically resent** to avoid duplicate Teams messages. Manual investigation and reconciliation is required.
- A single Teams card summarizes all branches; for very large branch counts, a size guard may truncate card details and explicitly says so. Detailed items remain in Supabase.
- The initial Google Sheet is a reporting template only; automatic Supabase → Google Sheets export must be added and tested separately.
- Keep any secrets in GitHub Actions secrets and Supabase Secrets; never paste them into issues, PR bodies, commits, logs, Google Sheets or ChatGPT.
- The source repository is public; no personal data or production messages should be committed.
