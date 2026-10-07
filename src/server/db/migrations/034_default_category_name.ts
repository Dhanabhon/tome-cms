import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

/**
 * The default category may be renamed: its name, and nothing else. Its address, its place as the
 * default, its owner, its descriptions and when it was made stay as they are, and it still cannot
 * be deleted while its owner exists. The row is compared whole but for the name and updated_at,
 * so a column added later is held too. The name "Uncategorized" stays the default's alone, so an
 * archive that names it means the default, and down can give the name back.
 *
 * Plain SQL, importing nothing of the app's: the runtime image loads every migration.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table categories drop constraint categories_default_name_check;
    alter table categories add constraint categories_default_name_check
      check (is_default or lower(name) <> 'uncategorized');

    create or replace function tomecms_protect_category() returns trigger
    language plpgsql as $$
    begin
      if tg_op = 'UPDATE' and new.owner_id is distinct from old.owner_id then
        raise exception 'Category owner cannot be changed.' using errcode = '23514';
      end if;
      if old.is_default and exists (select 1 from "user" where id = old.owner_id) and (
        tg_op = 'DELETE'
        or to_jsonb(new) - 'name' - 'updated_at' is distinct from to_jsonb(old) - 'name' - 'updated_at'
      ) then
        raise exception 'Uncategorized cannot be changed or deleted.' using errcode = '23514';
      end if;
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end;
    $$;
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  // Migration 005's rule wants the default called Uncategorized; this function still lets it be.
  await sql`
    update categories set name = 'Uncategorized' where is_default and name <> 'Uncategorized';

    create or replace function tomecms_protect_category() returns trigger
    language plpgsql as $$
    begin
      if tg_op = 'UPDATE' and new.owner_id is distinct from old.owner_id then
        raise exception 'Category owner cannot be changed.' using errcode = '23514';
      end if;
      if old.is_default and exists (select 1 from "user" where id = old.owner_id) then
        raise exception 'Uncategorized cannot be changed or deleted.' using errcode = '23514';
      end if;
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end;
    $$;

    alter table categories drop constraint categories_default_name_check;
    alter table categories add constraint categories_default_name_check check (
      (is_default and name = 'Uncategorized')
      or (not is_default and lower(name) <> 'uncategorized')
    );
  `.execute(db);
}
