-- Deleting a yarn type used to fail whenever it still had colours, because
-- yarn_colours.yarn_type_id was "on delete restrict" — yet the UI confirm
-- says "Delete <yarn> and all N colour(s) under it?". Cascade the delete to
-- its colours. It stays all-or-nothing: if the yarn or any of its colours
-- is used in a Production Order, Yarn Issue or Opening Balance (those FKs
-- are still "restrict"), the whole delete is refused and nothing is removed.
-- Safe to re-run.
alter table yarn_colours drop constraint if exists yarn_colours_yarn_type_id_fkey;
alter table yarn_colours
  add constraint yarn_colours_yarn_type_id_fkey
  foreign key (yarn_type_id) references yarn_types(id) on delete cascade;
