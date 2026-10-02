import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

/**
 * A header item may hold one level of sub-items, and a group is a label with no link that only
 * opens them. A sub-item stays in its parent's owner, language and menu, and every item there
 * before stays at the top level.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table navigation_items
      add column parent_id uuid,
      add constraint navigation_items_tree_key unique (id, owner_id, locale, location),
      add constraint navigation_items_parent_fkey foreign key (parent_id, owner_id, locale, location)
        references navigation_items (id, owner_id, locale, location) on delete cascade,
      drop constraint navigation_items_kind_check,
      add constraint navigation_items_kind_check check (kind in ('home', 'page', 'custom', 'group')),
      drop constraint navigation_items_target_check,
      add constraint navigation_items_target_check check (
        (kind = 'home' and page_id is null and url is null)
        or (kind = 'page' and page_id is not null and url is null)
        or (kind = 'custom' and page_id is null and url is not null)
        or (kind = 'group' and page_id is null and url is null)
      ),
      add constraint navigation_items_parent_header_check check (parent_id is null or location = 'header'),
      add constraint navigation_items_group_header_check check (kind <> 'group' or location = 'header');

    create index navigation_items_parent_idx on navigation_items (parent_id) where parent_id is not null;

    create function tomecms_navigation_one_level() returns trigger
    language plpgsql as $$
    begin
      if new.parent_id is not null and (
        new.parent_id = new.id
        or exists (select 1 from navigation_items where id = new.parent_id and parent_id is not null)
        or exists (select 1 from navigation_items where parent_id = new.id)
      ) then
        raise exception 'A sub-item cannot hold sub-items.' using errcode = '23514';
      end if;
      return new;
    end;
    $$;

    create trigger navigation_items_one_level before insert or update of parent_id on navigation_items
      for each row execute function tomecms_navigation_one_level();
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`
    delete from navigation_items where parent_id is not null or kind = 'group';
    drop trigger navigation_items_one_level on navigation_items;
    drop function tomecms_navigation_one_level();
    drop index navigation_items_parent_idx;
    alter table navigation_items
      drop constraint navigation_items_group_header_check,
      drop constraint navigation_items_parent_header_check,
      drop constraint navigation_items_target_check,
      add constraint navigation_items_target_check check (
        (kind = 'home' and page_id is null and url is null)
        or (kind = 'page' and page_id is not null and url is null)
        or (kind = 'custom' and page_id is null and url is not null)
      ),
      drop constraint navigation_items_kind_check,
      add constraint navigation_items_kind_check check (kind in ('home', 'page', 'custom')),
      drop constraint navigation_items_parent_fkey,
      drop column parent_id,
      drop constraint navigation_items_tree_key;
  `.execute(db);
}
