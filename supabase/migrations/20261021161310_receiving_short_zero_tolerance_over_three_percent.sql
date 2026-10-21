-- Receiving policy: shortage is never tolerated; positive overage >3% requires review.
-- Quality incidents are in another table and are unaffected.
alter table public.receiving_issues
  drop constraint if exists receiving_issues_weight_filter;
alter table public.receiving_issues
  add constraint receiving_issues_business_tolerance
    check (
      delta_qty < 0
      or (
        delta_qty > 0
        and (
          ordered_qty = 0
          or delta_qty * 100 > ordered_qty * 3
        )
      )
    );
comment on constraint receiving_issues_business_tolerance on public.receiving_issues
  is 'Any shortage is an issue; overages over 3 percent of ordered quantity are issues. Zero ordered quantity with receipt > 0 is an issue.';
