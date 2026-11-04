-- Weighted receiving differences of exactly +/- 3 kg are accepted.
-- Count units have no kilogram conversion and remain reportable for any nonzero delta.
alter table public.receiving_issues
  drop constraint receiving_issues_business_tolerance;

alter table public.receiving_issues
  add constraint receiving_issues_business_tolerance
  check (unit <> 'kg' or abs(delta_qty) > 3);
