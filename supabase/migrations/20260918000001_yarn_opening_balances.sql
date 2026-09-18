-- One-time starting balances per weaver+yarn+colour, as of go-live
-- (1 Apr 2026), for weavers who already owed yarn or already held excess
-- yarn before Production Orders/Yarn Issue existed in this system.
-- Exactly one of required_kg/excess_kg is meant to be set per row — a
-- single weaver+yarn+colour combo is either still owed yarn or already
-- holding excess, never both at once.
create table yarn_opening_balances (
  id            uuid primary key default gen_random_uuid(),
  weaver_id     uuid not null references weavers(id) on delete restrict,
  yarn_type_id  uuid not null references yarn_types(id) on delete restrict,
  colour_id     uuid not null references yarn_colours(id) on delete restrict,
  as_of_date    date not null default '2026-04-01',
  required_kg   numeric not null default 0 check (required_kg >= 0),
  excess_kg     numeric not null default 0 check (excess_kg >= 0),
  created_at    timestamptz not null default now(),
  unique (weaver_id, yarn_type_id, colour_id),
  check (not (required_kg > 0 and excess_kg > 0))
);
create index on yarn_opening_balances (weaver_id);

alter table yarn_opening_balances enable row level security;
create policy yarn_opening_balances_select on yarn_opening_balances for select using (auth.uid() is not null);
create policy yarn_opening_balances_insert on yarn_opening_balances for insert with check (auth.uid() is not null);
create policy yarn_opening_balances_update on yarn_opening_balances for update using (auth.uid() is not null) with check (auth.uid() is not null);
create policy yarn_opening_balances_delete on yarn_opening_balances for delete using (is_admin());

create trigger audit_yarn_opening_balances after insert or update or delete on yarn_opening_balances
  for each row execute function audit_trigger_fn();

-- Feed the opening balances into the same telescoping (required - issued)
-- math v_yarn_ledger already does across real FYs, by unioning them in as
-- a synthetic "FY" that sorts before every real FY label ("2025-26" etc
-- all start with a digit >= 1, "0000-OB" always sorts first). This makes
-- an opening required_kg behave exactly like a prior FY's unmet
-- requirement, and an opening excess_kg behave exactly like a prior FY's
-- issue — both already-proven code paths, so v_yarn_ledger and
-- v_yarn_ledger_all_weavers need no changes at all. The synthetic FY
-- label never matches a real `fy` filter (pages always query a real FY
-- label), so it only ever shows up folded into opening_balance, never as
-- its own row.
create or replace view v_yarn_required_by_fy with (security_invoker = true) as
select weaver_id, fy, yarn_type_id, colour_id, sum(kg) as required_kg
from v_po_yarn_requirement
group by weaver_id, fy, yarn_type_id, colour_id
union all
select weaver_id, '0000-OB' as fy, yarn_type_id, colour_id, required_kg
from yarn_opening_balances
where required_kg <> 0;

create or replace view v_yarn_issued_by_fy with (security_invoker = true) as
select yi.weaver_id, get_fy(yi.issue_date) as fy, it.yarn_type_id, it.colour_id, sum(it.qty) as issued_kg
from yarn_issues yi
join yarn_issue_items it on it.yarn_issue_id = yi.id
group by yi.weaver_id, get_fy(yi.issue_date), it.yarn_type_id, it.colour_id
union all
select weaver_id, '0000-OB' as fy, yarn_type_id, colour_id, excess_kg
from yarn_opening_balances
where excess_kg <> 0;
