-- Make these identifiers unique regardless of upper/lower case and stray
-- spaces ("Red" = "red" = " RED "):
--   yarn name (globally), colour name (within its yarn), PO No, RMDC No,
--   goods-receipt invoice no (within its weaver).
-- The old constraints only blocked exact-case matches. Safe to re-run.
--
-- Step 1 refuses to continue (changing nothing) if existing data already
-- has case-variant duplicates, and lists them so you can rename them first.
do $$
declare
  d record;
  msg text := '';
begin
  for d in
    select 'Yarn name' as what, string_agg(name, ' / ' order by name) as vals
    from yarn_types
    group by lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))
    having count(*) > 1
    union all
    select 'Colour under ' || t.name, string_agg(c.colour_name, ' / ' order by c.colour_name)
    from yarn_colours c join yarn_types t on t.id = c.yarn_type_id
    group by t.name, c.yarn_type_id, lower(regexp_replace(btrim(c.colour_name), '\s+', ' ', 'g'))
    having count(*) > 1
    union all
    select 'PO No', string_agg(po_no, ' / ' order by po_no)
    from production_orders
    group by lower(regexp_replace(btrim(po_no), '\s+', ' ', 'g'))
    having count(*) > 1
    union all
    select 'RMDC No', string_agg(issue_no, ' / ' order by issue_no)
    from yarn_issues
    group by lower(regexp_replace(btrim(issue_no), '\s+', ' ', 'g'))
    having count(*) > 1
    union all
    select 'Invoice No for ' || max(weaver_name), string_agg(inv_no, ' / ' order by inv_no)
    from goods_receipts
    group by weaver_id, lower(regexp_replace(btrim(inv_no), '\s+', ' ', 'g'))
    having count(*) > 1
  loop
    msg := msg || d.what || ': ' || d.vals || E'\n';
  end loop;

  if msg <> '' then
    raise exception E'Rename these duplicates (they differ only by case/spaces), then re-run:\n%', msg;
  end if;
end $$;

-- Step 2: swap the exact-match constraints for case-insensitive unique indexes.
alter table yarn_types drop constraint if exists yarn_types_name_key;
create unique index if not exists yarn_types_name_ci_key
  on yarn_types (lower(regexp_replace(btrim(name), '\s+', ' ', 'g')));

alter table yarn_colours drop constraint if exists yarn_colours_yarn_type_id_colour_name_key;
create unique index if not exists yarn_colours_name_ci_key
  on yarn_colours (yarn_type_id, lower(regexp_replace(btrim(colour_name), '\s+', ' ', 'g')));

alter table production_orders drop constraint if exists production_orders_po_no_key;
create unique index if not exists production_orders_po_no_ci_key
  on production_orders (lower(regexp_replace(btrim(po_no), '\s+', ' ', 'g')));

alter table yarn_issues drop constraint if exists yarn_issues_issue_no_key;
create unique index if not exists yarn_issues_issue_no_ci_key
  on yarn_issues (lower(regexp_replace(btrim(issue_no), '\s+', ' ', 'g')));

alter table goods_receipts drop constraint if exists goods_receipts_weaver_id_inv_no_key;
create unique index if not exists goods_receipts_inv_no_ci_key
  on goods_receipts (weaver_id, lower(regexp_replace(btrim(inv_no), '\s+', ' ', 'g')));
