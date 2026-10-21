# WHservice — Multiple LINE Groups (21 Oct 2026)

## Current implementation

- Single existing LINE OA and signed Supabase `line-webhook` (no new webhook URL).
- `groupId` is the stable identity; group display names can change.
- `line_group_registry` maps group IDs to `RECEIVING`, `QUALITY`, or `UNMAPPED`. Once classified, the route is stable until changed by an administrator.
- The bot tries LINE's Group Summary API (`GET /v2/bot/group/{groupId}/summary`) **only when** `LINE_CHANNEL_ACCESS_TOKEN` is safely configured in Supabase Edge Function secrets. Do not paste tokens into issues, chat, or code. If no token is configured, the bot uses conservative content hints to initialize the route and stores the group ID; the name stays unverified/null. Administrators can set `group_name` and `route` in the Supabase dashboard after a real group message appears.
- Messages from unmapped groups remain in `line_group_messages` for later review, not mixed into business reports. Quality-group text is stored in `line_quality_issues`; image/video/file events have **metadata/message IDs only** in `line_group_messages`, not file contents.
- Receiving messages continue using the existing deterministic parser and >5kg filter. Quality cases do **not** apply the ±5kg exclusion.
- Duplicate message IDs are ignored; unsend marks rows void. RLS protects all new tables and no public policies were created.

## Existing Google Sheet

`https://docs.google.com/spreadsheets/d/1jEFGBIUa1tStDaJSuI3HPvri6NdAICGTag2LCBGQAfM/edit`

- Existing `ISSUES`, `BRANCH_DAILY`, `REPORT_LOG` are preserved.
- `LINE_GROUPS`: stable group ID, verified name when available, route and source.
- `QUALITY_ISSUES`: fields such as branch, product, supplier, lot, amount, weight, defect, corrective action, and reviewed original text.
- `QUALITY_MEDIA`: source media message IDs and timestamps; actual photos are NOT backed up.
- `GROUP_DAILY`: daily counts by group of receiving items, quality cases and media.
- Existing Apps Script `syncReceivingIssues` fetches all datasets before writing and reuses the installed 15-minute trigger. It is never necessary to reinstall a second trigger.

## What must still be confirmed with live events

1. Check that WHservice is a member of each of the two intended LINE groups.
2. Send **new** text from each group (prior history is not delivered retroactively). The receiving group needs a quantity discrepancy that passes its filter, or check `line_group_messages` for messages filtered out. The quality group needs a new defect report. Media sent before route discovery may initially show as `UNMAPPED`.
3. Confirm `line_group_registry` contains **two distinct group IDs** and that their routes are correct. If group names are blank, configure/rotate the channel access token securely for the LINE Group Summary API or assign verified names directly in Supabase. Do not guess group IDs from screenshots.
4. Confirm `line_quality_issues` and `receiving_issues` each contain expected real records and that the next 15-minute Sheets sync populates their dedicated tabs. Never seed fake incidents as real.
5. Daily 08:00 Teams summary still reports only `receiving_issues`. Quality incidents are available in the separate Sheets tab/dashboard; enabling an additional outbound quality message requires distinct approved dispatch logic.

Keep all secrets outside public repository and logs. The old LINE access token previously shared in chat must be rotated, not reused.
