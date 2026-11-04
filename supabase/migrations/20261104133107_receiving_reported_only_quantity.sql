-- Preserve the quantity stated by a branch without inventing ordered/received totals.
alter table public.receiving_issues
  add column reported_missing_qty numeric(16,3),
  add column reported_action text;

alter table public.receiving_issues
  alter column ordered_qty drop not null,
  alter column received_qty drop not null,
  alter column delta_qty drop not null;

alter table public.receiving_issues
  drop constraint receiving_issues_variance_type_check;
alter table public.receiving_issues
  add constraint receiving_issues_variance_type_check
  check (variance_type in ('SHORT','OVER','NOT_RECEIVED','INCOMPLETE_RECEIPT'));

alter table public.receiving_issues
  drop constraint receiving_issues_not_received_zero;
alter table public.receiving_issues
  add constraint receiving_issues_quantity_shape
  check (
    (variance_type = 'SHORT' and ordered_qty is not null and received_qty is not null
      and delta_qty is not null and ordered_qty >= 0 and received_qty >= 0
      and delta_qty < 0)
    or (variance_type = 'OVER' and ordered_qty is not null and received_qty is not null
      and delta_qty is not null and ordered_qty >= 0 and received_qty >= 0
      and delta_qty > 0)
    or (variance_type = 'NOT_RECEIVED' and received_qty is not null
      and received_qty = 0 and
      ((ordered_qty is not null and delta_qty is not null and ordered_qty > 0
        and delta_qty = -ordered_qty) or
       (ordered_qty is null and delta_qty is null and reported_missing_qty is not null
        and reported_missing_qty > 0)))
    or (variance_type = 'INCOMPLETE_RECEIPT' and ordered_qty is null
      and received_qty is null and delta_qty is null and reported_missing_qty is not null
      and reported_missing_qty > 0)
  );
alter table public.receiving_issues
  add constraint receiving_issues_reported_missing_positive
  check (reported_missing_qty is null or reported_missing_qty > 0);

alter table public.receiving_issues
  drop constraint receiving_issues_business_tolerance;
alter table public.receiving_issues
  add constraint receiving_issues_business_tolerance
  check (variance_type in ('NOT_RECEIVED','INCOMPLETE_RECEIPT')
    or unit <> 'kg' or abs(delta_qty) > 3);
