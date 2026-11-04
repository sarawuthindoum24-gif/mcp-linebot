-- Explicitly not received goods are reportable at every quantity, including <= 3 kg.
-- Unlike measured shortages, these have a verified ordered quantity and zero receipt.
alter table public.receiving_issues
  drop constraint receiving_issues_variance_type_check;

alter table public.receiving_issues
  add constraint receiving_issues_variance_type_check
  check (variance_type in ('SHORT', 'OVER', 'NOT_RECEIVED'));

alter table public.receiving_issues
  add constraint receiving_issues_not_received_zero
  check (variance_type <> 'NOT_RECEIVED' or
    (ordered_qty > 0 and received_qty = 0 and delta_qty < 0));

alter table public.receiving_issues
  drop constraint receiving_issues_business_tolerance;

alter table public.receiving_issues
  add constraint receiving_issues_business_tolerance
  check (variance_type = 'NOT_RECEIVED' or unit <> 'kg' or abs(delta_qty) > 3);
