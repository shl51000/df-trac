-- =====================================================================
-- Fix: v_po_yarn_requirement's select list dropped `feeder_no` when the
-- weft/warp sub-views were combined into one, even though
-- v_po_weft_requirement itself has it — so every row rendered in Yarn
-- Required's "By Production Order" breakdown showed "F" + undefined
-- ("Fundefined") instead of "F1", "F2", etc.
--
-- Appended as the LAST column (rather than restoring its original
-- position) so this can be a plain `create or replace view` — Postgres
-- allows replacing a view with one that adds trailing columns without
-- dropping it, which matters here since v_yarn_required_by_fy and others
-- already depend on this view and a drop would cascade into them.
-- =====================================================================
create or replace view v_po_yarn_requirement with (security_invoker = true) as
select production_order_id, po_no, po_date, fy, weaver_id, status, yarn_type_id, yarn_type_name,
       colour_id, colour_name, qty_mtrs, kg, false as is_warp, feeder_no
from v_po_weft_requirement
union all
select production_order_id, po_no, po_date, fy, weaver_id, status, yarn_type_id, yarn_type_name,
       colour_id, colour_name, qty_mtrs, kg, true as is_warp, null::smallint as feeder_no
from v_po_warp_requirement;
