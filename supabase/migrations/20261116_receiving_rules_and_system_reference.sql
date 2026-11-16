-- Align database writes with the previously approved receiving policy:
-- every shortage is reportable; overage up to and including 3% is tolerated.
-- Historical rows are preserved unmodified, including one old ±3kg-rule
-- overage row that must be reconciled separately. NOT VALID only exempts
-- historical rows; every new INSERT/UPDATE must comply.
alter table public.receiving_issues
  drop constraint if exists receiving_issues_business_tolerance;
alter table public.receiving_issues
  add constraint receiving_issues_business_tolerance
  check (
    variance_type in ('NOT_RECEIVED','INCOMPLETE_RECEIPT')
    or (variance_type='SHORT' and delta_qty<0)
    or (variance_type='OVER' and delta_qty>0 and
        (ordered_qty=0 or
         (ordered_qty>0 and delta_qty*100>ordered_qty*3)))
  ) not valid;
comment on constraint receiving_issues_business_tolerance on public.receiving_issues
  is 'Current policy: any SHORT, all NOT_RECEIVED/INCOMPLETE_RECEIPT, and OVER strictly more than 3% of ordered reference. NOT VALID retains one prior legacy row for review.';
