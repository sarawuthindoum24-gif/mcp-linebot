
-- One LINE OA, independently identified group conversations and issue domains.
create table if not exists public.line_group_registry (
  group_id text primary key,
  group_name text,
  route text not null default 'UNMAPPED'
    check (route in ('UNMAPPED','RECEIVING','QUALITY')),
  route_source text not null default 'UNKNOWN'
    check (route_source in ('UNKNOWN','LINE_API','TEXT_HINT','MANUAL')),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create table if not exists public.line_group_messages (
  line_message_id text primary key,
  group_id text not null references public.line_group_registry(group_id),
  message_type text not null,
  route text not null default 'UNMAPPED'
    check (route in ('UNMAPPED','RECEIVING','QUALITY')),
  message_at timestamptz not null,
  raw_text text,
  is_void boolean not null default false,
  voided_at timestamptz,
  recorded_at timestamptz not null default now()
);
create index if not exists line_group_messages_group_date_idx
  on public.line_group_messages(group_id,message_at desc);
create table if not exists public.line_quality_issues (
  line_message_id text primary key references public.line_group_messages(line_message_id),
  group_id text not null references public.line_group_registry(group_id),
  message_at timestamptz not null,
  branch text,
  product text,
  supplier text,
  lot text,
  quantity_text text,
  weight_text text,
  defect text,
  resolution text,
  status text not null default 'PENDING_REVIEW',
  raw_text text not null,
  is_void boolean not null default false,
  voided_at timestamptz
);
create index if not exists line_quality_issues_group_date_idx
  on public.line_quality_issues(group_id,message_at desc);
alter table public.receiving_issues
  add column if not exists group_id text references public.line_group_registry(group_id);
alter table public.receiving_parse_review
  add column if not exists group_id text references public.line_group_registry(group_id);
create index if not exists receiving_issues_group_id_idx on public.receiving_issues(group_id);
alter table public.line_group_registry enable row level security;
alter table public.line_group_messages enable row level security;
alter table public.line_quality_issues enable row level security;
-- Server-only writes/read via service role; no policies for anon/authenticated.
revoke all on table public.line_group_registry, public.line_group_messages,
  public.line_quality_issues from anon,authenticated;
