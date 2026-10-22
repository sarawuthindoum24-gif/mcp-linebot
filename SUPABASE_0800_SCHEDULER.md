# 08:00 Asia/Bangkok BNN Teams report — primary scheduler

The GitHub schedule on 22 Oct 2026 missed 08:00 entirely (no `schedule` run). The 21 Oct report was recovered through GitHub Actions run [39710138504](https://github.com/sarawuthindoum24-gif/mcp-linebot/actions/runs/39710138504) at 09:13 Bangkok, producing one `SENT` dispatch.

## New primary

- Supabase Postgres **pg_cron**, job `bnn-receiving-teams-primary-0800`: `0 1 * * *` at `cron.timezone=GMT`, so **08:00 Bangkok daily**.
- Uses `pg_net` to POST to existing `daily-teams-report` with a distinct random **256-bit** token generated and encrypted in Supabase Vault (`bnn_receiving_daily_cron_token`). The cron command dynamically reads Vault. Do not copy token values into GitHub, chat, Sheet or logs.
- Server-side Edge Function independently authenticates the cron token by SHA-256 hash stored in `public.receiving_cron_auth`, protected by RLS and denied to anon/authenticated. Existing GitHub `DAILY_REPORT_SECRET` authentication remains supported.
- The same `receiving_report_dispatches` key `(report_date, destination)` prevents duplicate sends even if both cron and GitHub run.
- GitHub remains as backup (08:00 and 08:17 Bangkok). Do **not** add another report scheduler unless confirmed necessary.

## Evidence

- Authentication via Vault/pg_net was tested on 22 Oct 2026: request returned HTTP 200 and JSON `{"status":"ALREADY_SENT","date":"2026-10-21"}`. No duplicate Teams delivery.
- pg_cron engine smoke job `select 1` executed with status `succeeded`; smoke job was immediately unscheduled.
- The primary job was confirmed `active=true`, GMT timezone, 01:00 UTC.
- **Remaining verification:** observe the first real primary job invocation and recipient Teams chat card on **23 October 2026 at 08:00 Bangkok**. Supabase's `SENT` status means webhook accepted, not proof the card appeared in the recipient's app.

## Read-only checks

```sql
select jobid, jobname, schedule, active from cron.job
where jobname = 'bnn-receiving-teams-primary-0800';
select jobid, status, start_time, return_message from cron.job_run_details
where jobid = (select jobid from cron.job
               where jobname = 'bnn-receiving-teams-primary-0800')
order by start_time desc limit 5;
select report_date, destination, status, updated_at, error_code
from public.receiving_report_dispatches order by report_date desc limit 5;
```

If primary fails, investigate `net._http_response` and Edge logs. Never reset a `SENT` record or resend without checking the recipient's Teams chat. To disable primary explicitly, use `cron.alter_job(job_id := <id>,active := false)`; to pause backup set GitHub variable `RECEIVING_BOT_DAILY_PAUSED=true`.
