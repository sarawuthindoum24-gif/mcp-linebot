# BNN Receiving Issue Bot — Supabase-first (Draft)

**Status (live audit, 21 Oct 2026):** DATABASE CREATED + EDGE FUNCTIONS DEPLOYED / LINE OA WEBHOOK MOVED TO SUPABASE AND LINE VERIFY SUCCEEDED / `LINE-01-Webhook-Collector` OFF / LIVE SIGNED SYNTHETIC WEBHOOK AND DATABASE READBACK PASSED / PERSONAL TEAMS PILOT FLOW DELIVERED A SYNTHETIC CARD TO THE INTENDED 1:1 CHAT / SUPABASE-TO-TEAMS ROUTE AND 08:00 SCHEDULE STILL DISABLED. No real LINE group message or Supabase-generated Teams report has yet been observed.

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

1. **Completed 20 Oct 2026:** Supabase project `gevivzvlfloaczpunymx` is ACTIVE_HEALTHY; tables created via migration; Edge Functions `line-webhook` and `daily-teams-report` deployed (both v6 on 21 Oct). Their live source files match this branch after line-ending normalization. Validate everything with synthetic test messages before production.
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
6. **Completed 21 Oct 2026:** The account owner corrected `LINE_CHANNEL_SECRET` at 10:45 Bangkok time. Its SHA-256 fingerprint matched the LINE channel 2009069246 Basic settings value without revealing that value. The LINE OA webhook was repointed to `https://gevivzvlfloaczpunymx.supabase.co/functions/v1/line-webhook`, LINE Developers Verify returned Success, Use webhook remained checked, and the old `LINE-01-Webhook-Collector` Flow was turned Off. The LINE channel secret belongs only in Supabase Edge Function Secrets; never copy it into this repository.
7. Invite the OA to the actual LINE group, grant the bot group participation permission in LINE Developers, and run a **synthetic** signed webhook test. Do not test using real branch stock adjustments.
8. A separate Power Automate Flow, **BNN Receiving Issues - Personal Teams Report (Pilot)**, was saved and turned on. Both its normal-card and attachment-card actions use `Post as: Flow bot`, `Post in: Chat with Flow bot`, and the selected intended recipient in the Teams UI. A synthetic card sent to the Pilot webhook on 21 Oct at 10:19 Bangkok time returned HTTP 202; the Flow run succeeded, its Teams action returned 201, and the exact card was found in the intended Workflows personal chat at 10:19. This verifies the Pilot Flow's chat delivery only; the Supabase daily function has not invoked it. An earlier unused draft copy was turned off; the pre-existing WH section Flow was not edited. Copy only the Pilot Flow's callback URL directly into Supabase Edge Function Secret `TEAMS_WEBHOOK_URL` without recording it in the repository.
9. **Only after recipient confirmation, rotated LINE token, signed webhook validation and supervised pilot:** merge this PR into default branch and enable daily workflow. Before that keep `RECEIVING_BOT_DAILY_ENABLED` unset/false.  GitHub scheduled workflows run on the repository default branch, at 01:00 UTC (08:00 Bangkok), and can execute later than their nominal time.

## Remaining configuration (required for a real LINE-to-Teams end-to-end test)

1. **Completed:** LINE channel secret matches, the OA points to Supabase, LINE Developers Verify succeeded, and LINE-01 is Off. A direct signed synthetic request to the deployed function returned HTTP 200. No raw secret value was printed or stored in this repository.
2. In Power Automate, open **BNN Receiving Issues - Personal Teams Report (Pilot)** and copy its incoming webhook callback directly into Supabase secret `TEAMS_WEBHOOK_URL`. Generate a strong independent `DAILY_REPORT_SECRET` and enter it in both Supabase and GitHub Actions Secrets. The Pilot webhook-to-personal-chat delivery has been verified, but its callback has not been stored in Supabase. Do not use the earlier disabled Draft Flow's callback.
3. **Completed:** The new route passed LINE Verify before LINE-01 was turned Off. Keep monitoring real group delivery and function logs; a direct signed synthetic request is not proof that the actual group has emitted an event to the new route.
4. **Completed with direct synthetic requests against the deployed function:** +5 and -5 kg produced 0 issue rows; +6 and -7 kg produced 2 rows; repeating the same event kept 2 rows; an unsend marked both rows void. Only the exact tagged synthetic rows were deleted after readback, leaving 0 synthetic rows. A controlled message sent from the real LINE group remains to be observed.
5. Invoke the Supabase daily report function with synthetic data, confirm the same personal Teams chat receives it, and review `receiving_report_dispatches` before enabling the 08:00 schedule. The separate Pilot Flow synthetic card already reached that chat.

## Run tests

```bash
deno test supabase/functions/_shared/parser_test.ts
```

## Important caveats

- The parser intentionally supports **only explicit order-and-actual quantity text lines with units**. Other wording is flagged for review. No OCR, image inspection, AI guesses, adjustment of SAP/POS stock, or automatic return/claim handling.
- Direct LINE webhook deployment requires a dedicated webhook URL and the LINE **channel secret**. A previously posted long-lived channel **access token must be revoked and regenerated**; it is not needed for signature verification and is deliberately absent from this repository.
- If LINE sends `unsend`, the source message is invalidated by setting `is_void` on stored rows. An unsend delivered ahead of the original source message is a follow-up enhancement before production.
- Supabase database and two Edge Functions exist and are active. The LINE channel secret fingerprint matches LINE; the OA uses the new route and LINE-01 is Off. The Teams Workflows URL has not yet been stored in Supabase, so the personal Teams Pilot Flow's synthetic delivery is verified independently of the daily function.
- Daily report dispatches are claimed before Teams delivery. When a request fails or has uncertain remote status, it is marked FAILED and **not automatically resent** to avoid duplicate Teams messages. Manual investigation and reconciliation is required.
- A single Teams card summarizes all branches; for very large branch counts, a size guard may truncate card details and explicitly says so. Detailed items remain in Supabase.
- The initial Google Sheet is a reporting template only; automatic Supabase → Google Sheets export must be added and tested separately.
- Keep any secrets in GitHub Actions secrets and Supabase Secrets; never paste them into issues, PR bodies, commits, logs, Google Sheets or ChatGPT.
- The source repository is public; no personal data or production messages should be committed.

## Verified current deployment

- Supabase project: `gevivzvlfloaczpunymx` (`ACTIVE_HEALTHY`)
- Tables created: `public.receiving_issues`, `public.receiving_parse_review`, `public.receiving_report_dispatches` (RLS enabled; no public policies)
- Functions: `line-webhook` v6 `ACTIVE`; `daily-teams-report` v6 `ACTIVE`. Live source matches the repository branch after line-ending normalization.
- LINE destination: `@842nltit` has Use webhook ON and points to the Supabase `line-webhook` function. LINE Developers Verify returned Success after the move. Pre-existing LINE-01 Power Automate Flow is Off.
- Teams destination: separate Power Automate personal-chat Pilot Flow configured and On for the selected recipient. Synthetic card delivered on 21 Oct 10:19 Bangkok time: webhook HTTP 202, run succeeded, Teams action 201, exact card found in Workflows personal chat. The Codex Teams connector has not been connected; Supabase daily-function delivery remains untested.
- CI: parser tests and Edge Function type checks succeeded on latest implementation commit
- Supabase Edge Function Secrets has a matching `LINE_CHANNEL_SECRET` but no verified `TEAMS_WEBHOOK_URL` or `DAILY_REPORT_SECRET`; the unintended `Channel access token` entry was removed. GitHub Actions has **no repository secrets or variables** as of the latest audit.
- The account owner reported reissuing the access token previously provided in ChatGPT. A later UI inspection accidentally surfaced the then-current token in an internal tool result, and a subsequent chat reply exposed another reissued token. The account owner must reissue again after setup and keep the new token out of chat. Never put the token in a file, tool arguments, migration, or secret log.
- Local synthetic signed-handler test covers invalid signature, +5/-5 kg exclusion, +6/-6 kg storage, duplicate delivery, and unsend. A transaction-rolled-back database test passed the same quantity, duplicate, and void checks. The deployed function returned HTTP 200 for direct signed synthetic events; database readback confirmed +5/-5 excluded, +6/-7 stored, duplicate suppressed, and unsend voided both stored rows. Tagged synthetic rows were then removed and a zero-row readback passed. These tests do not prove that a real LINE group message has reached the new route.
