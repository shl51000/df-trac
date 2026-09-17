-- =====================================================================
-- DF-Trac — initial schema
-- South Handlooms PO & Yarn Ledger — single business, two roles
-- (admin, user), audit log, soft-retire via is_active on masters.
-- =====================================================================

create extension if not exists pgcrypto; -- gen_random_uuid()

-- =====================================================================
-- 1. ROLES / PROFILES
-- =====================================================================
create type user_role as enum ('admin', 'user');

create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text not null,
  mobile     text,
  role       user_role not null default 'user',
  created_at timestamptz not null default now()
);

-- Auto-create a profile row whenever someone signs up via Supabase Auth.
-- New accounts default to 'user'; an existing admin promotes them later.
create function handle_new_user() returns trigger as $$
begin
  insert into public.profiles (id, name, mobile, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', new.email), new.raw_user_meta_data->>'mobile', 'user');
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Only an admin may change someone's role (including their own — no
-- self-escalation from a plain 'user' account).
create function is_admin() returns boolean as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$ language sql stable security definer set search_path = public;

create function prevent_role_self_escalation() returns trigger as $$
begin
  if new.role is distinct from old.role and not is_admin() then
    raise exception 'Only an admin can change roles.';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger profiles_guard_role
  before update on profiles
  for each row execute function prevent_role_self_escalation();

-- =====================================================================
-- 2. MASTERS
-- =====================================================================
create table yarn_types (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  denier     text not null,          -- e.g. "150D" (trailing "D" kept, as in the prototype)
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (name, denier)
);

create table yarn_colours (
  id            uuid primary key default gen_random_uuid(),
  yarn_type_id  uuid not null references yarn_types(id) on delete restrict,
  colour_name   text not null,
  unique (yarn_type_id, colour_name)
);
create index on yarn_colours (yarn_type_id);

create table fabric_types (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,   -- Design No prefix, e.g. "MS"
  name           text not null,
  measuring_term text not null check (measuring_term in ('Mts', 'Pcs')),
  is_active      boolean not null default true
);

create table weavers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  address    text,
  whatsapp   text,
  email      text,
  is_active  boolean not null default true
);

-- =====================================================================
-- 3. DESIGN LIBRARY
-- =====================================================================
create table design_sheets (               -- uploaded spec-sheet photo metadata;
  id           uuid primary key default gen_random_uuid(),  -- bytes live in Supabase Storage
  storage_path text not null,
  file_name    text,
  uploaded_at  timestamptz not null default now()
);

-- One row PER BASE PICK VALUE on a spec sheet — e.g. "MS-147 (60)" and
-- "MS-147 (56)" are two separate design rows sharing the same header.
create table designs (
  id             uuid primary key default gen_random_uuid(),
  design_no      text not null,     -- "MS-147" — shared across pick-value siblings
  label          text not null,     -- "MS-147 (60)"
  hooks          text,
  reed           text,              -- e.g. "96r"
  pick           text,              -- header/base pick label, e.g. "60p" (display only)
  panno          text,
  material_type  text,
  cut_size       numeric not null default 1,
  salvage        numeric,           -- backend-only Weft width allowance, see widthForYarnRequired
  average_pick   numeric,
  sheet_id       uuid references design_sheets(id),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);
create index on designs (design_no);

create table design_feeders (
  id         uuid primary key default gen_random_uuid(),
  design_id  uuid not null references designs(id) on delete cascade,
  feeder_no  smallint not null check (feeder_no between 1 and 8),
  card       text,      -- blank / "-" / "0" all mean "feeder not used"
  pick       numeric,
  unique (design_id, feeder_no)
);

-- The Nth *active* feeder on a design, in design order — Production
-- Order feeder rows are always built only from active feeders, so this
-- lets the ledger views join order feeder #N back to the right design row.
create view design_active_feeders with (security_invoker = true) as
select
  design_id,
  feeder_no as design_feeder_no,
  card,
  pick,
  row_number() over (partition by design_id order by feeder_no) as seq
from design_feeders
where card is not null and trim(card) <> '' and trim(card) <> '-' and trim(card) <> '0';

-- =====================================================================
-- 4. PRODUCTION ORDERS
-- =====================================================================
create type po_status as enum ('pending', 'closed', 'short-closed');

create table production_orders (
  id                   uuid primary key default gen_random_uuid(),
  po_no                text not null unique,
  po_date              date not null,
  width                numeric not null,
  remarks              text,
  unit                 text not null check (unit in ('Mts', 'Pcs')),  -- snapshot from Fabric Type
  cut_size_used        numeric not null,

  design_id            uuid references designs(id) on delete restrict,
  design_no            text not null,   -- snapshot
  design_label         text not null,   -- snapshot
  reed                 text,
  pick                 text,

  weaver_id            uuid references weavers(id) on delete restrict,
  weaver_name          text not null,   -- snapshot
  weaver_address       text,
  weaver_whatsapp      text,
  weaver_email         text,

  warp_yarn_type_id    uuid references yarn_types(id) on delete restrict,
  warp_yarn_type_name  text not null,
  warp_colour_id       uuid references yarn_colours(id) on delete restrict,
  warp_colour_name     text not null,

  total_mtrs           numeric not null,
  sheet_id             uuid references design_sheets(id),
  status               po_status not null default 'pending',
  closed_at            timestamptz,
  created_at           timestamptz not null default now()
);
create index on production_orders (design_id);
create index on production_orders (weaver_id);
create index on production_orders (po_date);
create index on production_orders (status);

create table production_order_feeder_quality (
  id                   uuid primary key default gen_random_uuid(),
  production_order_id  uuid not null references production_orders(id) on delete cascade,
  feeder_no            smallint not null,   -- 1..N over ACTIVE feeders only, matches design_active_feeders.seq
  yarn_type_id         uuid references yarn_types(id) on delete restrict,
  yarn_type_name       text not null,       -- snapshot
  unique (production_order_id, feeder_no)
);
create index on production_order_feeder_quality (production_order_id);

create table production_order_lines (
  id                   uuid primary key default gen_random_uuid(),
  production_order_id  uuid not null references production_orders(id) on delete cascade,
  sl                   int not null,
  qty                  numeric not null,   -- pcs or mts, per the order's own unit
  mts                  numeric not null    -- mts-equivalent (qty itself when unit = Mts)
);
create index on production_order_lines (production_order_id);

create table production_order_line_colours (
  id          uuid primary key default gen_random_uuid(),
  line_id     uuid not null references production_order_lines(id) on delete cascade,
  feeder_no   smallint not null,
  colour_id   uuid references yarn_colours(id) on delete restrict,
  colour_name text not null,               -- snapshot
  unique (line_id, feeder_no)
);
create index on production_order_line_colours (line_id);

-- =====================================================================
-- 5. GOODS RECEIPTS
-- =====================================================================
create table goods_receipts (
  id          uuid primary key default gen_random_uuid(),
  inv_no      text not null,
  inv_date    date not null,
  weaver_id   uuid references weavers(id) on delete restrict,
  weaver_name text not null,
  po_id       uuid not null references production_orders(id) on delete restrict,
  po_no       text not null,
  design_label text not null,
  unit        text not null check (unit in ('Mts', 'Pcs')),
  qty         numeric not null,   -- as entered
  mts         numeric not null,   -- mts-equivalent
  created_at  timestamptz not null default now(),
  unique (weaver_id, inv_no)
);
create index on goods_receipts (po_id);
create index on goods_receipts (weaver_id);
create index on goods_receipts (inv_date);

-- =====================================================================
-- 6. YARN ISSUE / RMDC
-- =====================================================================
create table yarn_issues (
  id            uuid primary key default gen_random_uuid(),
  issue_no      text not null unique,
  issue_date    date not null,
  weaver_id     uuid references weavers(id) on delete restrict,
  weaver_name   text not null,
  remarks       text,
  supplier_name text,
  transport_name text,
  lr_no         text,
  lr_date       date,
  payment_term  text,
  total_qty     numeric not null default 0,
  total_amount  numeric not null default 0,
  created_at    timestamptz not null default now()
);
create index on yarn_issues (weaver_id);
create index on yarn_issues (issue_date);

create table yarn_issue_items (
  id             uuid primary key default gen_random_uuid(),
  yarn_issue_id  uuid not null references yarn_issues(id) on delete cascade,
  sl             int not null,
  yarn_type_id   uuid references yarn_types(id) on delete restrict,
  yarn_type_name text not null,
  colour_id      uuid references yarn_colours(id) on delete restrict,
  colour_name    text not null,
  qty            numeric not null,
  rate           numeric,
  amount         numeric
);
create index on yarn_issue_items (yarn_issue_id);
create index on yarn_issue_items (yarn_type_id, colour_id);

-- =====================================================================
-- 7. FINANCIAL YEAR STATE
-- Every transaction's FY is derived from its own date (get_fy below) —
-- never stored on the row. financial_years just tracks which FY labels
-- are known and whether each is closed; app_settings holds the single
-- shared "currently active FY" the whole app is scoped to.
-- =====================================================================
create table financial_years (
  label      text primary key,   -- "2026-27"
  is_closed  boolean not null default false
);

create table app_settings (
  id         boolean primary key default true check (id),  -- singleton row
  current_fy text not null references financial_years(label)
);

create function get_fy(d date) returns text as $$
  select case when d is null then null else
    (case when extract(month from d) >= 4 then extract(year from d) else extract(year from d) - 1 end)::text
    || '-' ||
    lpad(((case when extract(month from d) >= 4 then extract(year from d) else extract(year from d) - 1 end + 1) % 100)::text, 2, '0')
  end;
$$ language sql immutable;

create function is_fy_closed(d date) returns boolean as $$
  select coalesce((select is_closed from financial_years where label = get_fy(d)), false);
$$ language sql stable;

-- Registers a not-yet-seen FY the first time a transaction lands in it,
-- and blocks the write if that FY has been closed from the sidebar.
create function ensure_fy_open(d date) returns void as $$
declare
  fy text;
  closed boolean;
begin
  fy := get_fy(d);
  insert into financial_years (label) values (fy) on conflict (label) do nothing;
  select is_closed into closed from financial_years where label = fy;
  if closed then
    raise exception 'Financial year % is closed — switch to an open year to make changes.', fy;
  end if;
end;
$$ language plpgsql security definer set search_path = public;

-- ---- FY gate triggers: parent transaction tables ----
create function trg_fy_gate_po() returns trigger as $$
begin
  if tg_op = 'DELETE' then
    if is_fy_closed(old.po_date) then
      raise exception 'Financial year % is closed.', get_fy(old.po_date);
    end if;
    return old;
  else
    perform ensure_fy_open(new.po_date);
    return new;
  end if;
end;
$$ language plpgsql security definer set search_path = public;
create trigger fy_gate_po before insert or update or delete on production_orders
  for each row execute function trg_fy_gate_po();

create function trg_fy_gate_receipt() returns trigger as $$
begin
  if tg_op = 'DELETE' then
    if is_fy_closed(old.inv_date) then
      raise exception 'Financial year % is closed.', get_fy(old.inv_date);
    end if;
    return old;
  else
    perform ensure_fy_open(new.inv_date);
    return new;
  end if;
end;
$$ language plpgsql security definer set search_path = public;
create trigger fy_gate_receipt before insert or update or delete on goods_receipts
  for each row execute function trg_fy_gate_receipt();

create function trg_fy_gate_issue() returns trigger as $$
begin
  if tg_op = 'DELETE' then
    if is_fy_closed(old.issue_date) then
      raise exception 'Financial year % is closed.', get_fy(old.issue_date);
    end if;
    return old;
  else
    perform ensure_fy_open(new.issue_date);
    return new;
  end if;
end;
$$ language plpgsql security definer set search_path = public;
create trigger fy_gate_issue before insert or update or delete on yarn_issues
  for each row execute function trg_fy_gate_issue();

-- ---- FY gate triggers: child rows (block edits even if only a line/item changes) ----
create function trg_fy_gate_po_child() returns trigger as $$
declare d date;
begin
  select po_date into d from production_orders where id = coalesce(new.production_order_id, old.production_order_id);
  if is_fy_closed(d) then
    raise exception 'Financial year % is closed.', get_fy(d);
  end if;
  return coalesce(new, old);
end;
$$ language plpgsql security definer set search_path = public;
create trigger fy_gate_po_feeder_quality before insert or update or delete on production_order_feeder_quality
  for each row execute function trg_fy_gate_po_child();
create trigger fy_gate_po_lines before insert or update or delete on production_order_lines
  for each row execute function trg_fy_gate_po_child();

create function trg_fy_gate_po_line_child() returns trigger as $$
declare d date;
begin
  select po.po_date into d
    from production_order_lines l join production_orders po on po.id = l.production_order_id
    where l.id = coalesce(new.line_id, old.line_id);
  if is_fy_closed(d) then
    raise exception 'Financial year % is closed.', get_fy(d);
  end if;
  return coalesce(new, old);
end;
$$ language plpgsql security definer set search_path = public;
create trigger fy_gate_po_line_colours before insert or update or delete on production_order_line_colours
  for each row execute function trg_fy_gate_po_line_child();

create function trg_fy_gate_issue_child() returns trigger as $$
declare d date;
begin
  select issue_date into d from yarn_issues where id = coalesce(new.yarn_issue_id, old.yarn_issue_id);
  if is_fy_closed(d) then
    raise exception 'Financial year % is closed.', get_fy(d);
  end if;
  return coalesce(new, old);
end;
$$ language plpgsql security definer set search_path = public;
create trigger fy_gate_issue_items before insert or update or delete on yarn_issue_items
  for each row execute function trg_fy_gate_issue_child();

-- =====================================================================
-- 8. AUDIT LOG
-- Captures who did what to which row, with before/after values, for
-- every master and transaction table — now that multiple real people
-- share this app.
-- =====================================================================
create table audit_log (
  id         bigint generated always as identity primary key,
  user_id    uuid references auth.users(id),
  action     text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  table_name text not null,
  record_id  text,
  old_data   jsonb,
  new_data   jsonb,
  created_at timestamptz not null default now()
);
create index on audit_log (table_name, record_id);
create index on audit_log (user_id);
create index on audit_log (created_at);

create function audit_trigger_fn() returns trigger as $$
declare
  rec_id text;
begin
  if tg_op = 'DELETE' then
    rec_id := coalesce(to_jsonb(old)->>'id', to_jsonb(old)->>'label');
  else
    rec_id := coalesce(to_jsonb(new)->>'id', to_jsonb(new)->>'label');
  end if;

  insert into audit_log (user_id, action, table_name, record_id, old_data, new_data)
  values (
    auth.uid(),
    tg_op,
    tg_table_name,
    rec_id,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('UPDATE', 'INSERT') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$ language plpgsql security definer set search_path = public;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'yarn_types', 'yarn_colours', 'fabric_types', 'weavers',
    'design_sheets', 'designs', 'design_feeders',
    'production_orders', 'production_order_feeder_quality', 'production_order_lines', 'production_order_line_colours',
    'goods_receipts', 'yarn_issues', 'yarn_issue_items',
    'financial_years', 'app_settings'
  ]
  loop
    execute format('create trigger audit_%1$s after insert or update or delete on %1$s for each row execute function audit_trigger_fn();', t);
  end loop;
end $$;

-- =====================================================================
-- 9. ROW LEVEL SECURITY
-- Two roles only: any signed-in user (role 'user' or 'admin') can read
-- and write every business table — matching the prototype's "User can
-- do everything except delete". Delete is admin-only everywhere, via
-- the on-delete-restrict FKs above plus these policies. financial_years
-- close/reopen is admin-only; switching the active FY (app_settings) is
-- open to both roles, as in the prototype's FY switcher.
-- =====================================================================
alter table profiles enable row level security;
alter table yarn_types enable row level security;
alter table yarn_colours enable row level security;
alter table fabric_types enable row level security;
alter table weavers enable row level security;
alter table design_sheets enable row level security;
alter table designs enable row level security;
alter table design_feeders enable row level security;
alter table production_orders enable row level security;
alter table production_order_feeder_quality enable row level security;
alter table production_order_lines enable row level security;
alter table production_order_line_colours enable row level security;
alter table goods_receipts enable row level security;
alter table yarn_issues enable row level security;
alter table yarn_issue_items enable row level security;
alter table financial_years enable row level security;
alter table app_settings enable row level security;
alter table audit_log enable row level security;

-- profiles: everyone signed in can see the directory; a user can only
-- edit their own name/mobile (role changes are blocked for non-admins
-- by the trigger above, not by this policy), admin can edit anyone's.
create policy profiles_select on profiles for select using (auth.uid() is not null);
create policy profiles_update_self on profiles for update using (auth.uid() = id or is_admin());
create policy profiles_insert_admin on profiles for insert with check (is_admin());
create policy profiles_delete_admin on profiles for delete using (is_admin());

-- Generic pattern for every plain business table: read/insert/update
-- open to any signed-in user, delete restricted to admin.
do $$
declare t text;
begin
  foreach t in array array[
    'yarn_types', 'yarn_colours', 'fabric_types', 'weavers',
    'design_sheets', 'designs', 'design_feeders',
    'production_orders', 'production_order_feeder_quality', 'production_order_lines', 'production_order_line_colours',
    'goods_receipts', 'yarn_issues', 'yarn_issue_items'
  ]
  loop
    execute format('create policy %1$s_select on %1$s for select using (auth.uid() is not null);', t);
    execute format('create policy %1$s_insert on %1$s for insert with check (auth.uid() is not null);', t);
    execute format('create policy %1$s_update on %1$s for update using (auth.uid() is not null) with check (auth.uid() is not null);', t);
    execute format('create policy %1$s_delete on %1$s for delete using (is_admin());', t);
  end loop;
end $$;

-- financial_years: everyone can read; only admin can open/close a year
-- (row creation itself happens through ensure_fy_open(), which runs as
-- security definer and so bypasses these policies).
create policy fy_select on financial_years for select using (auth.uid() is not null);
create policy fy_update_admin on financial_years for update using (is_admin());

-- app_settings: everyone can read and switch the active FY; row is
-- seeded once below and never inserted/deleted from the app.
create policy settings_select on app_settings for select using (auth.uid() is not null);
create policy settings_update on app_settings for update using (auth.uid() is not null) with check (auth.uid() is not null);

-- audit_log: admin-only read; no direct insert/update/delete policies
-- for any role — the only writer is audit_trigger_fn(), which runs as
-- security definer and so bypasses RLS entirely.
create policy audit_select_admin on audit_log for select using (is_admin());

-- =====================================================================
-- 10. YARN REQUIRED / LEDGER VIEWS
-- Mirrors computeOrderYarnRequirement / buildColourLedger from the
-- prototype exactly — nothing here is stored, it's all derived live.
-- =====================================================================

-- Strips any trailing unit-letter (D/r/p) or other non-numeric noise
-- off a stored text field, e.g. "150D" -> 150, "96r" -> 96.
create function numeric_prefix(t text) returns numeric as $$
  select nullif(regexp_replace(coalesce(t, ''), '[^0-9.]', '', 'g'), '')::numeric;
$$ language sql immutable;

-- Weft: one row per production order × active feeder × colourway line.
create view v_po_weft_requirement with (security_invoker = true) as
select
  po.id as production_order_id, po.po_no, po.po_date, get_fy(po.po_date) as fy,
  po.weaver_id, po.status,
  foq.feeder_no,
  foq.yarn_type_id, foq.yarn_type_name,
  lc.colour_id, lc.colour_name,
  pol.id as line_id, pol.mts as qty_mtrs,
  coalesce(numeric_prefix(yt.denier), 0) * (po.width + coalesce(d.salvage, 0)) * 110 * coalesce(daf.pick, 0)
    / 9000000 / 100 * pol.mts as kg
from production_orders po
join designs d on d.id = po.design_id
join production_order_feeder_quality foq on foq.production_order_id = po.id
join design_active_feeders daf on daf.design_id = po.design_id and daf.seq = foq.feeder_no
join yarn_types yt on yt.id = foq.yarn_type_id
join production_order_lines pol on pol.production_order_id = po.id
join production_order_line_colours lc on lc.line_id = pol.id and lc.feeder_no = foq.feeder_no;

-- Warp: one row per production order (not per feeder/colourway).
create view v_po_warp_requirement with (security_invoker = true) as
select
  po.id as production_order_id, po.po_no, po.po_date, get_fy(po.po_date) as fy,
  po.weaver_id, po.status,
  po.warp_yarn_type_id as yarn_type_id, po.warp_yarn_type_name as yarn_type_name,
  po.warp_colour_id as colour_id, po.warp_colour_name as colour_name,
  po.total_mtrs as qty_mtrs,
  coalesce(numeric_prefix(wyt.denier), 0) * ((po.width * 1.04 * coalesce(numeric_prefix(d.reed), 0)) + 100) * po.total_mtrs
    / 9000000 * 1.10 as kg
from production_orders po
join designs d on d.id = po.design_id
join yarn_types wyt on wyt.id = po.warp_yarn_type_id;

-- Combined per-order requirement (weft + warp rows).
create view v_po_yarn_requirement with (security_invoker = true) as
select production_order_id, po_no, po_date, fy, weaver_id, status, yarn_type_id, yarn_type_name,
       colour_id, colour_name, qty_mtrs, kg, false as is_warp
from v_po_weft_requirement
union all
select production_order_id, po_no, po_date, fy, weaver_id, status, yarn_type_id, yarn_type_name,
       colour_id, colour_name, qty_mtrs, kg, true as is_warp
from v_po_warp_requirement;

-- Required kg per yarn+colour+weaver+FY, from every order regardless of
-- status (matches the prototype: "Summary is always net of every order
-- regardless of status — Yarn Issued already accounts for what a closed
-- order actually consumed").
create view v_yarn_required_by_fy with (security_invoker = true) as
select weaver_id, fy, yarn_type_id, colour_id, sum(kg) as required_kg
from v_po_yarn_requirement
group by weaver_id, fy, yarn_type_id, colour_id;

-- Issued kg per yarn+colour+weaver+FY.
create view v_yarn_issued_by_fy with (security_invoker = true) as
select yi.weaver_id, get_fy(yi.issue_date) as fy, it.yarn_type_id, it.colour_id, sum(it.qty) as issued_kg
from yarn_issues yi
join yarn_issue_items it on it.yarn_issue_id = yi.id
group by yi.weaver_id, get_fy(yi.issue_date), it.yarn_type_id, it.colour_id;

-- Full ledger, per weaver: opening balance = every prior FY's
-- (required - issued) telescoped down to one carried-forward figure;
-- closing balance = opening + this FY's required - issued. Positive
-- closing = still owed ("Yarn Required"); zero/negative = supplied
-- beyond what was needed ("Excess in Hand" / Stock-in-Hand).
create view v_yarn_ledger with (security_invoker = true) as
with keys as (
  select weaver_id, fy, yarn_type_id, colour_id from v_yarn_required_by_fy
  union
  select weaver_id, fy, yarn_type_id, colour_id from v_yarn_issued_by_fy
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

-- Same ledger rolled up across all weavers (the "All weavers" filter).
create view v_yarn_ledger_all_weavers with (security_invoker = true) as
with by_fy as (
  select fy, yarn_type_id, colour_id,
         sum(required_kg) as required_kg, sum(issued_kg) as issued_kg
  from (
    select fy, yarn_type_id, colour_id, required_kg, 0 as issued_kg from v_yarn_required_by_fy
    union all
    select fy, yarn_type_id, colour_id, 0 as required_kg, issued_kg from v_yarn_issued_by_fy
  ) x
  group by fy, yarn_type_id, colour_id
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

-- Pending Orders: ordered vs received per PO (Goods Receipts already
-- store an mts-equivalent, so this is a plain sum-and-subtract).
create view v_po_pending_balance with (security_invoker = true) as
select
  po.id as production_order_id, po.po_no, po.status, po.weaver_id, po.po_date,
  po.total_mtrs,
  coalesce(sum(gr.mts), 0) as received_mts,
  po.total_mtrs - coalesce(sum(gr.mts), 0) as balance_mts
from production_orders po
left join goods_receipts gr on gr.po_id = po.id
group by po.id;

-- =====================================================================
-- 11. GRANTS
-- RLS policies only restrict rows; the `authenticated` role still needs
-- ordinary table/view privileges to reach them at all. Supabase projects
-- normally provision this by default, but stating it here keeps the
-- migration self-contained, and the ALTER DEFAULT PRIVILEGES lines carry
-- it forward to tables created by later migrations too.
-- =====================================================================
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all sequences in schema public to authenticated;

alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant select on sequences to authenticated;

-- =====================================================================
-- 12. SEED
-- =====================================================================
insert into financial_years (label, is_closed) values (get_fy(current_date), false);
insert into app_settings (id, current_fy) values (true, get_fy(current_date));
