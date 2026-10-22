-- Supabase-backed 08:00 scheduler avoids dropped GitHub scheduled events.
-- Keep the daily-report Edge Function's existing GitHub secret unchanged.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.receiving_cron_auth (
  id integer primary key check (id = 1),
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);
alter table public.receiving_cron_auth enable row level security;
revoke all on public.receiving_cron_auth from anon, authenticated;
-- Service-role only, with no anon/authenticated policies.

do $token$
begin
  if not exists (select 1 from vault.secrets where name = 'bnn_receiving_daily_cron_token') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'bnn_receiving_daily_cron_token',
      'Independent daily Teams cron key: do not expose in code, GitHub or sheets.'
    );
  end if;
end $token$;
insert into public.receiving_cron_auth(id, token_hash)
select 1, encode(extensions.digest(decrypted_secret, 'sha256'), 'hex')
from vault.decrypted_secrets where name = 'bnn_receiving_daily_cron_token'
on conflict (id) do nothing;
