-- =====================================================================
-- Storage bucket for uploaded design spec-sheet photos. Private bucket
-- (not `public`) — files are only reachable by a signed-in user via the
-- authenticated download path, governed by the policies below, same as
-- every other table in this app.
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('design-sheets', 'design-sheets', false)
on conflict (id) do nothing;

create policy "design_sheets_select" on storage.objects
  for select using (bucket_id = 'design-sheets' and auth.uid() is not null);

create policy "design_sheets_insert" on storage.objects
  for insert with check (bucket_id = 'design-sheets' and auth.uid() is not null);

create policy "design_sheets_delete" on storage.objects
  for delete using (bucket_id = 'design-sheets' and is_admin());
