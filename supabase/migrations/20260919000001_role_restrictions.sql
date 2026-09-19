-- Role rules: admin can do everything; a plain 'user' can never delete
-- (already true of every standalone table via is_admin() delete policies),
-- cannot add/change Opening Balance (view only), and has no Users screen,
-- so they can no longer list other people's profiles or edit profiles.
-- Safe to re-run.

-- Opening Balance: read stays open to every signed-in user; writes admin-only
-- (delete was already admin-only).
drop policy if exists yarn_opening_balances_insert on yarn_opening_balances;
drop policy if exists yarn_opening_balances_update on yarn_opening_balances;
create policy yarn_opening_balances_insert on yarn_opening_balances for insert with check (is_admin());
create policy yarn_opening_balances_update on yarn_opening_balances for update using (is_admin()) with check (is_admin());

-- Profiles: a user can read only their own row (the app loads it at login
-- to find their role); admin can read and edit everyone's.
drop policy if exists profiles_select on profiles;
drop policy if exists profiles_update_self on profiles;
drop policy if exists profiles_update_admin on profiles;
create policy profiles_select on profiles for select using (auth.uid() = id or is_admin());
create policy profiles_update_admin on profiles for update using (is_admin());
