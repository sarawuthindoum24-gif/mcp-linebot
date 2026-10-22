-- Primary schedule: 01:00 UTC = 08:00 Asia/Bangkok; idempotency is
-- enforced by receiving_report_dispatches (report_date, destination).
-- Vault token is fetched only at execution time; its value is never saved
-- in the cron job SQL source, GitHub or other public configuration.
select cron.schedule(
  'bnn-receiving-teams-primary-0800',
  '0 1 * * *',
  $job$
    select net.http_post(
      url := 'https://gevivzvlfloaczpunymx.supabase.co/functions/v1/daily-teams-report',
      body := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-report-cron-token',
        (select decrypted_secret from vault.decrypted_secrets
         where name = 'bnn_receiving_daily_cron_token')
      ),
      timeout_milliseconds := 12000
    );
  $job$
);