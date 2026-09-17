-- =====================================================================
-- Fix: v_yarn_ledger / v_yarn_ledger_all_weavers only produced a row for
-- a (weaver, yarn, colour) combo in a given FY when THAT SPECIFIC combo
-- had a Required or Issued entry *in that exact FY*. A combo with a
-- carried-forward balance from an earlier year but zero new activity in
-- the current FY simply had no row for the current FY at all — so Yarn
-- Required's summary would silently omit a weaver who genuinely still
-- owed yarn (or was still sitting on excess) from a prior year, purely
-- because nothing happened this year.
--
-- Fixed by crossing every combo that ever had activity with every FY on
-- record (`financial_years`, which only ever contains years that have
-- actually had a transaction — see ensure_fy_open()) from that combo's
-- own first-activity year onward, so its balance keeps carrying forward
-- through quiet years instead of vanishing.
-- =====================================================================

drop view if exists v_yarn_ledger;
drop view if exists v_yarn_ledger_all_weavers;

create view v_yarn_ledger with (security_invoker = true) as
with combos as (
  select weaver_id, yarn_type_id, colour_id, min(fy) as first_fy
  from (
    select weaver_id, yarn_type_id, colour_id, fy from v_yarn_required_by_fy
    union
    select weaver_id, yarn_type_id, colour_id, fy from v_yarn_issued_by_fy
  ) x
  group by weaver_id, yarn_type_id, colour_id
),
keys as (
  select c.weaver_id, c.yarn_type_id, c.colour_id, f.label as fy
  from combos c
  join financial_years f on f.label >= c.first_fy
),
combined as (
  select k.weaver_id, k.fy, k.yarn_type_id, k.colour_id,
         coalesce(req.required_kg, 0) as required_kg,
         coalesce(iss.issued_kg, 0) as issued_kg
  from keys k
  left join v_yarn_required_by_fy req using (weaver_id, fy, yarn_type_id, colour_id)
  left join v_yarn_issued_by_fy iss using (weaver_id, fy, yarn_type_id, colour_id)
)
select
  weaver_id, fy, yarn_type_id, colour_id, required_kg, issued_kg,
  sum(required_kg - issued_kg) over (
    partition by weaver_id, yarn_type_id, colour_id order by fy
    rows between unbounded preceding and 1 preceding
  ) as opening_balance,
  sum(required_kg - issued_kg) over (
    partition by weaver_id, yarn_type_id, colour_id order by fy
    rows between unbounded preceding and current row
  ) as closing_balance
from combined;

create view v_yarn_ledger_all_weavers with (security_invoker = true) as
with req_agg as (
  select fy, yarn_type_id, colour_id, sum(required_kg) as required_kg
  from v_yarn_required_by_fy
  group by fy, yarn_type_id, colour_id
),
iss_agg as (
  select fy, yarn_type_id, colour_id, sum(issued_kg) as issued_kg
  from v_yarn_issued_by_fy
  group by fy, yarn_type_id, colour_id
),
combos as (
  select yarn_type_id, colour_id, min(fy) as first_fy
  from (
    select yarn_type_id, colour_id, fy from req_agg
    union
    select yarn_type_id, colour_id, fy from iss_agg
  ) x
  group by yarn_type_id, colour_id
),
keys as (
  select c.yarn_type_id, c.colour_id, f.label as fy
  from combos c
  join financial_years f on f.label >= c.first_fy
),
by_fy as (
  select k.fy, k.yarn_type_id, k.colour_id,
         coalesce(r.required_kg, 0) as required_kg,
         coalesce(i.issued_kg, 0) as issued_kg
  from keys k
  left join req_agg r on r.fy = k.fy and r.yarn_type_id = k.yarn_type_id and r.colour_id = k.colour_id
  left join iss_agg i on i.fy = k.fy and i.yarn_type_id = k.yarn_type_id and i.colour_id = k.colour_id
)
select
  fy, yarn_type_id, colour_id, required_kg, issued_kg,
  sum(required_kg - issued_kg) over (
    partition by yarn_type_id, colour_id order by fy
    rows between unbounded preceding and 1 preceding
  ) as opening_balance,
  sum(required_kg - issued_kg) over (
    partition by yarn_type_id, colour_id order by fy
    rows between unbounded preceding and current row
  ) as closing_balance
from by_fy;
