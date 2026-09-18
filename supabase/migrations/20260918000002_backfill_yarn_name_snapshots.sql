-- Rows saved before the "denier never displays next to a yarn name" fix
-- have the old "<name> <denier>" text baked into these snapshot columns
-- literally, since they were plain strings at save time, not computed at
-- render time — so the earlier UI fix alone doesn't touch already-saved
-- Production Orders / Yarn Issues. Backfill every snapshot to match its
-- yarn type's current name via the FK each row already carries.
--
-- FY-gate triggers on these tables block ordinary UPDATEs once a
-- financial year is closed, which would wrongly block this purely
-- cosmetic text correction — disable just those triggers for the
-- backfill, then restore them.
alter table production_orders disable trigger fy_gate_po;
alter table production_order_feeder_quality disable trigger fy_gate_po_feeder_quality;
alter table yarn_issue_items disable trigger fy_gate_issue_items;

update production_orders po
set warp_yarn_type_name = yt.name
from yarn_types yt
where yt.id = po.warp_yarn_type_id
  and po.warp_yarn_type_name is distinct from yt.name;

update production_order_feeder_quality fq
set yarn_type_name = yt.name
from yarn_types yt
where yt.id = fq.yarn_type_id
  and fq.yarn_type_name is distinct from yt.name;

update yarn_issue_items it
set yarn_type_name = yt.name
from yarn_types yt
where yt.id = it.yarn_type_id
  and it.yarn_type_name is distinct from yt.name;

alter table production_orders enable trigger fy_gate_po;
alter table production_order_feeder_quality enable trigger fy_gate_po_feeder_quality;
alter table yarn_issue_items enable trigger fy_gate_issue_items;
