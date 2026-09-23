-- Fix: opening balances never reached v_yarn_ledger / v_yarn_ledger_all_weavers.
--
-- Opening balances are fed into v_yarn_required_by_fy / v_yarn_issued_by_fy
-- under the synthetic FY label '0000-OB'. But both ledger views only build
-- rows for FYs listed in `financial_years`, and '0000-OB' is not (and must
-- not be) a real financial year — so its rows were silently dropped before
-- the running-balance window function ever saw them. Result: every colour
-- ledger showed no opening balance, and closing balances / Yarn Required
-- summaries ignored the opening figures.
--
-- Fix: let the FY list used for each combo also include '0000-OB'. It only
-- ever matches combos whose first activity IS the opening balance (because
-- '0000-OB' sorts before every real FY), and it becomes a row that the
-- window function carries into that combo's first real FY. Pages always
-- filter on a real FY label, so the '0000-OB' row itself never displays.
-- Safe to re-run.

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
  join (select label from financial_years union all select '0000-OB') f on f.label >= c.first_fy
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
  join (select label from financial_years union all select '0000-OB') f on f.label >= c.first_fy
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
