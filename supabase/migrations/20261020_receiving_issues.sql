-- Apply only after reviewing the schema in a separate Supabase staging project.
create extension if not exists pgcrypto;

create table if not exists public.receiving_issues (
  id uuid primary key default gen_random_uuid(),
  line_message_id text not null,
  line_item_index integer not null check (line_item_index >= 1),
  branch text not null,
  product text not null,
  issue_date date not null,
  message_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  ordered_qty numeric(16,3) not null,
  received_qty numeric(16,3) not null,
  delta_qty numeric(16,3) not null,
  unit text not null,
  variance_type text not null check (variance_type in ('SHORT','OVER')),
  status text not null default 'PENDING_REVIEW',
  is_void boolean not null default false,
  voided_at timestamptz,
  constraint receiving_issues_unique_line_item unique(line_message_id, line_item_index),
  constraint receiving_issues_delta_check check (delta_qty = received_qty - ordered_qty),
  constraint receiving_issues_nonzero check (delta_qty <> 0),
  constraint receiving_issues_weight_filter check (
    unit <> 'kg' or abs(delta_qty) > 5
  )
);

create index if not exists receiving_issues_message_at_idx
  on public.receiving_issues(message_at, branch) where is_void = false;

create table if not exists public.receiving_parse_review (
  line_message_id text primary key,
  message_at timestamptz not null,
  reason text not null,
  recorded_at timestamptz not null default now()
  -- Intentionally does not store raw LINE content or any excluded line.
);

create table if not exists public.receiving_report_dispatches (
  report_date date not null,
  destination text not null,
  status text not null check(status in ('SENDING','SENT','FAILED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  error_code text,
  primary key(report_date, destination)
);

alter table public.receiving_issues enable row level security;
alter table public.receiving_parse_review enable row level security;
alter table public.receiving_report_dispatches enable row level security;
-- No public policies. Edge Functions use service-role credentials server-side only.
