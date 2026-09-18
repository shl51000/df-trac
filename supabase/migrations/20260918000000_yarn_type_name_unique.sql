-- Yarn name must be unique on its own — a name is no longer allowed to
-- repeat across different deniers (e.g. two "Viscose Filament" rows at
-- 150D and 300D). Denier stopped being shown next to the name anywhere
-- in the UI, so two same-named yarns would have been indistinguishable
-- in every dropdown/list. If this fails with a unique_violation, resolve
-- the duplicate name(s) in yarn_types by hand (rename or merge) before
-- re-running.
alter table yarn_types drop constraint yarn_types_name_denier_key;
alter table yarn_types add constraint yarn_types_name_key unique (name);
