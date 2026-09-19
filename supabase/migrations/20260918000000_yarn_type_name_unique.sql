-- Yarn name must be unique on its own — a name is no longer allowed to
-- repeat across different deniers (e.g. two "Viscose Filament" rows at
-- 150D and 300D). Denier stopped being shown next to the name anywhere
-- in the UI, so two same-named yarns would have been indistinguishable
-- in every dropdown/list. If this fails with a unique_violation, resolve
-- the duplicate name(s) in yarn_types by hand (rename or merge) before
-- re-running. Safe to re-run: each step is skipped if already done.
alter table yarn_types drop constraint if exists yarn_types_name_denier_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'yarn_types'::regclass and conname = 'yarn_types_name_key'
  ) then
    alter table yarn_types add constraint yarn_types_name_key unique (name);
  end if;
end $$;
