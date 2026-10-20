# BNN Receiving Issue Bot — Supabase-first (Draft)

**Status:** DATABASE CREATED + EDGE FUNCTIONS DEPLOYED / NOT CONNECTED TO LINE OR TEAMS / SCHEDULE DISABLED. This feature is new and isolated. It does not modify the pre-existing `LINE-01-Webhook-Collector` or `LINE-02-Text-Receiving-Processor` pipeline, whose separate approval gates still apply.

## Business logic

1. Receive text messages from LINE group/room using a signed Messaging API webhook.
2. Verify the `x-line-signature` HMAC-SHA256 against the **channel secret** and the unchanged raw HTTP body before parsing.
3. Detect branch name, issue date, and individual product lines.
4. Calculate `received_qty - ordered_qty` from actual quantities. Positive = OVER, negative = SHORT.
5. **Do not store weighted lines whose absolute difference is at most 5.000 kg (including exactly 5.000 kg).** Grams are converted to kilograms; counted goods are not subject to this threshold.
6. Store eligible product items only in Supabase PostgreSQL. Neither rejected raw lines nor complete LINE raw message payloads are stored by this new bot.
7. Collect only minimal `line_message_id` metadata for unparsed-item review; no raw text.
8. On LINE unsend, mark matched stored items void (do not delete audit history).
9. At 08:00 Bangkok time, summarize **messages received on the previous Bangkok calendar day** and post a single grouped report to a **1:1 Teams chat** via an authorized Microsoft Teams Workflows chat-webhook template.
10. Google Sheets is a **secondary reporting/mirror destination**, not the system of record. Its automatic synchronization is not yet implemented in this draft.

## Example acceptance

- Branch จตุจักรชลบุรี; ปลาหมึกกรอบ ordered 25 kg, actual 30 kg → +5 kg → **not stored**
- Same branch; ปลาหมึกสด ordered 30 kg, actual 25 kg → −5 kg → **not stored**
- 6 kg / −6 kg → stored.
- Two units short (`ชิ้น`) → stored.
- Missing unit or other ambiguous fields → safe needs-review marker, not an invented quantity.

## Configuration (never commit tokens)

1. **Completed 20 Oct 2026:** Supabase project `gevivzvlfloaczpunymx` is ACTIVE_HEALTHY; tables created via migration; Edge Functions `line-webhook` and `daily-teams-report` deployed as v1. Validate everything with synthetic test messages before production.
2. Configure **Supabase Edge Function secrets**:
   - `LINE_CHANNEL_SECRET`: from LINE Developers > Basic settings (NOT the channel access token).
   - `SUPABASE_URL`: project API URL (normally available to Edge Functions).
   - `SUPABASE_SERVICE_ROLE_KEY`: server-side key (normally available to Edge Functions; never use in a browser).
   - `TEAMS_WEBHOOK_URL`: Teams Workflows incoming-webhook URL for a **1:1 Teams chat** via an authorized Microsoft Teams Workflows chat-webhook template.
   - `DAILY_REPORT_SECRET`: generate an independent strong random string; match GitHub secret below.
3. Configure **GitHub repository secrets** (Actions):
   - `SUPABASE_ACCESS_TOKEN` (Supabase Management API/CLI PAT; not LINE channel token).
   - Supabase project ref is a non-secret already configured in the gated GitHub Action workflows.
   - `DAILY_REPORT_SECRET`.
4. Configure **GitHub repository variables** (Actions):
   - `RECEIVING_BOT_DEPLOY_APPROVED=true` only after SQL/schema/signature/test sign-off.
   - `RECEIVING_BOT_DAILY_ENABLED=true` only after controlled pilot approval and verified Teams one-to-one chat destination.
5. After approval, run the **manual** workflow `Deploy Receiving Bot Edge Functions (manual)`. It deploys functions only; the migration must already have been applied.
6. **Do not change a currently working LINE Webhook URL yet.** A LINE Messaging API channel normally has one configured webhook receiver. Check whether the given OA is already sending events to `LINE-01-Webhook-Collector`. Replacing that URL without a relay/fanout plan may interrupt existing processing. After verifying routing, configure the authorized endpoint: `https://gevivzvlfloaczpunymx.supabase.co/functions/v1/line-webhook` in LINE Developers > Messaging API > Webhook URL; then verify and enable. Channel secret is in LINE Developers > Basic settings and must be stored only under Supabase Edge Function Secrets.
7. Invite the OA to the actual LINE group, grant the bot group participation permission in LINE Developers, and run a **synthetic** signed webhook test. Do not test using real branch stock adjustments.
8. In Microsoft Teams > Workflows, create **Send webhook alerts to a chat** (or a Flow with `When a Teams webhook request is received` followed by `Post a message in a chat or channel` → `Post as: Flow bot` → `Post in: Chat with Flow bot` → recipient selected in the Teams UI). Select the exact intended individual chat using the user-provided recipient account. Save the Flow and put its callback URL into Supabase Edge Function Secret `TEAMS_WEBHOOK_URL`. Do not commit the recipient email or Flow URL to this public repository. Send a synthetic card to verify the actual recipient.
9. **Only after recipient confirmation, rotated LINE token, signed webhook validation and supervised pilot:** merge this PR into default branch and enable daily workflow. Before that keep `RECEIVING_BOT_DAILY_ENABLED` unset/false.  GitHub scheduled workflows run on the repository default branch, at 01:00 UTC (08:00 Bangkok), and can execute later than their nominal time.

## Remaining manual configuration (required for a real LINE-to-Teams end-to-end test)

1. Supabase Dashboard → Edge Functions → Secrets → create `LINE_CHANNEL_SECRET` from LINE Developers Basic settings. This is NOT the access token previously exposed in chat.
2. In Microsoft Teams Workflows, create a **personal-chat** incoming webhook / personal-recipient Flow, specifically selecting the intended recipient account there. Store the callback as Supabase secret `TEAMS_WEBHOOK_URL` and a strong `DAILY_REPORT_SECRET` in both Supabase and GitHub Actions Secrets. **No Teams callback URL is configured yet.**
3. Verify the existing Webhook URL in LINE Developers BEFORE changing it. If the existing `LINE-01-Webhook-Collector` uses the same OA/channel, design an authorized fan-out or replace only after the owner approves. Do not silently break existing collection.
4. With the secret configured and a valid webhook route, use the LINE Developers Verify button, then send test text in a controlled LINE group. Confirm exactly 5 kg produces 0 rows, 6 kg produces 1 row, repeated message creates no duplicates, and unsend voids items.
5. Send a synthetic report into the selected personal Teams chat, verify who received it, and review `receiving_report_dispatches` before enabling the 08:00 schedule.

## Run tests

```bash
deno test supabase/functions/_shared/parser_test.ts
```

## Important caveats

- The parser intentionally supports **only explicit order-and-actual quantity text lines with units**. Other wording is flagged for review. No OCR, image inspection, AI guesses, adjustment of SAP/POS stock, or automatic return/claim handling.
- Direct LINE webhook deployment requires a dedicated webhook URL and the LINE **channel secret**. A previously posted long-lived channel **access token must be revoked and regenerated**; it is not needed for signature verification and is deliberately absent from this repository.
- If LINE sends `unsend`, the source message is invalidated by setting `is_void` on stored rows. An unsend delivered ahead of the original source message is a follow-up enhancement before production.
- Supabase database and two Edge Functions exist and are active, but LINE channel secret and Teams Workflows URL are NOT configured by this deployment. The functions fail closed until secrets are provided. No LINE group webhook was changed and no Teams personal-chat message was sent.
- Daily report dispatches are claimed before Teams delivery. When a request fails or has uncertain remote status, it is marked FAILED and **not automatically resent** to avoid duplicate Teams messages. Manual investigation and reconciliation is required.
- A single Teams card summarizes all branches; for very large branch counts, a size guard may truncate card details and explicitly says so. Detailed items remain in Supabase.
- The initial Google Sheet is a reporting template only; automatic Supabase → Google Sheets export must be added and tested separately.
- Keep any secrets in GitHub Actions secrets and Supabase Secrets; never paste them into issues, PR bodies, commits, logs, Google Sheets or ChatGPT.
- The source repository is public; no personal data or production messages should be committed.

## Verified current deployment

- Supabase project: `gevivzvlfloaczpunymx` (`ACTIVE_HEALTHY`)
- Tables created: `public.receiving_issues`, `public.receiving_parse_review`, `public.receiving_report_dispatches` (RLS enabled; no public policies)
- Functions: `line-webhook` v1 `ACTIVE`; `daily-teams-report` v1 `ACTIVE`
- LINE destination: currently **NOT set** in LINE Developers by this workflow; current old webhook status unknown
- Teams destination: **NOT connected**; no personal chat posted
- CI: parser tests and Edge Function type checks succeeded on latest implementation commit
- Access token provided in ChatGPT must be revoked/reissued. Never put it in a file, tool arguments, migration, or secret log
