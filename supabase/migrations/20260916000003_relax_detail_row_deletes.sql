-- =====================================================================
-- Fix: the generic "delete = admin only" policy from the init migration
-- was applied to every table, including detail/child rows that have no
-- standalone Delete button of their own and are only ever replaced as
-- an internal step of an ordinary edit (e.g. saving a Production Order
-- deletes-then-reinserts its feeder-quality/line/line-colour rows).
--
-- For a non-admin "user" account, that delete step was silently blocked
-- by RLS (0 rows affected, no error) — the reinsert then collided with
-- the leftover feeder-quality rows on the unique (production_order_id,
-- feeder_no) constraint and failed, which looked like "feeder data got
-- lost and can't be re-saved".
--
-- Fix: these detail tables get the same "any signed-in user" rule as
-- insert/update, matching the prototype's actual rule — "User can do
-- everything except delete" meant delete of a *record* (a whole design,
-- weaver, production order, ...), never a form's own detail rows.
-- =====================================================================
alter policy production_order_feeder_quality_delete on production_order_feeder_quality using (auth.uid() is not null);
alter policy production_order_lines_delete on production_order_lines using (auth.uid() is not null);
alter policy production_order_line_colours_delete on production_order_line_colours using (auth.uid() is not null);
alter policy design_feeders_delete on design_feeders using (auth.uid() is not null);
alter policy yarn_issue_items_delete on yarn_issue_items using (auth.uid() is not null);
