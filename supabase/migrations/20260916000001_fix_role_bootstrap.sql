-- =====================================================================
-- Fix: prevent_role_self_escalation() blocked EVERY role change,
-- including one run from the SQL Editor or a service-role script,
-- because auth.uid() is null there and is_admin() then returns false.
-- That made it impossible to ever promote the first admin.
--
-- Fix: only guard role changes made by an authenticated *app* session
-- (auth.uid() is not null). A null auth.uid() means the call came from
-- the SQL Editor, the CLI, or a service-role key — a privileged context
-- that isn't subject to this particular guard.
-- =====================================================================
create or replace function prevent_role_self_escalation() returns trigger as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null and not is_admin() then
    raise exception 'Only an admin can change roles.';
  end if;
  return new;
end;
$$ language plpgsql;
