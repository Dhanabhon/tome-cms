import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table post_translation_groups (
      id uuid primary key default gen_random_uuid(),
      owner_id text not null references "user"(id) on delete cascade,
      created_at timestamptz not null default current_timestamp,
      unique (id, owner_id)
    );

    create table page_translation_groups (
      id uuid primary key default gen_random_uuid(),
      owner_id text not null references "user"(id) on delete cascade,
      created_at timestamptz not null default current_timestamp,
      unique (id, owner_id)
    );

    create table categories (
      id uuid primary key default gen_random_uuid(),
      owner_id text not null references "user"(id) on delete cascade,
      name text not null,
      is_default boolean not null default false,
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp,
      unique (id, owner_id),
      constraint categories_name_check check (name = btrim(name) and char_length(name) between 1 and 80),
      constraint categories_default_name_check check (
        (is_default and name = 'Uncategorized')
        or (not is_default and lower(name) <> 'uncategorized')
      )
    );

    create table posts (
      id uuid primary key default gen_random_uuid(),
      translation_group_id uuid not null,
      locale text not null,
      title text not null,
      slug text not null,
      cover_media_id uuid,
      content_json jsonb not null,
      content_html text not null,
      meta_title text,
      meta_description text,
      status text not null default 'draft',
      published_at timestamptz,
      owner_id text not null,
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp,
      constraint posts_group_owner_fkey foreign key (translation_group_id, owner_id)
        references post_translation_groups(id, owner_id) on delete cascade,
      constraint posts_locale_check check (locale in ('th', 'en')),
      constraint posts_title_check check (title = btrim(title) and char_length(title) between 1 and 200),
      constraint posts_slug_check check (char_length(slug) between 1 and 160 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
      constraint posts_content_json_check check (
        jsonb_typeof(content_json) = 'object'
        and content_json ->> 'type' = 'doc'
        and octet_length(content_json::text) <= 1000000
      ),
      constraint posts_content_html_check check (octet_length(content_html) <= 1000000),
      constraint posts_meta_title_check check (meta_title is null or char_length(meta_title) <= 70),
      constraint posts_meta_description_check check (meta_description is null or char_length(meta_description) <= 320),
      constraint posts_status_check check (status in ('draft', 'published')),
      unique (translation_group_id, locale),
      unique (locale, slug),
      unique (id, owner_id, locale)
    );

    create table pages (
      id uuid primary key default gen_random_uuid(),
      translation_group_id uuid not null,
      locale text not null,
      title text not null,
      slug text not null,
      content_json jsonb not null,
      content_html text not null,
      meta_title text,
      meta_description text,
      status text not null default 'draft',
      published_at timestamptz,
      owner_id text not null,
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp,
      constraint pages_group_owner_fkey foreign key (translation_group_id, owner_id)
        references page_translation_groups(id, owner_id) on delete cascade,
      constraint pages_locale_check check (locale in ('th', 'en')),
      constraint pages_title_check check (title = btrim(title) and char_length(title) between 1 and 200),
      constraint pages_slug_check check (char_length(slug) between 1 and 160 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
      constraint pages_content_json_check check (
        jsonb_typeof(content_json) = 'object'
        and content_json ->> 'type' = 'doc'
        and octet_length(content_json::text) <= 1000000
      ),
      constraint pages_content_html_check check (octet_length(content_html) <= 1000000),
      constraint pages_meta_title_check check (meta_title is null or char_length(meta_title) <= 70),
      constraint pages_meta_description_check check (meta_description is null or char_length(meta_description) <= 320),
      constraint pages_status_check check (status in ('draft', 'published')),
      unique (translation_group_id, locale),
      unique (locale, slug),
      unique (id, owner_id, locale)
    );

    create table post_category_assignments (
      translation_group_id uuid not null,
      category_id uuid not null,
      owner_id text not null,
      created_at timestamptz not null default current_timestamp,
      primary key (translation_group_id, category_id),
      constraint post_category_assignments_group_owner_fkey
        foreign key (translation_group_id, owner_id)
        references post_translation_groups(id, owner_id) on delete cascade,
      constraint post_category_assignments_category_owner_fkey
        foreign key (category_id, owner_id)
        references categories(id, owner_id) on delete cascade
    );

    create table navigation_items (
      id uuid primary key default gen_random_uuid(),
      owner_id text not null references "user"(id) on delete cascade,
      locale text not null,
      location text not null,
      kind text not null,
      label text not null,
      page_id uuid,
      url text,
      position integer not null,
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp,
      constraint navigation_items_locale_check check (locale in ('th', 'en')),
      constraint navigation_items_location_check check (location in ('header', 'footer')),
      constraint navigation_items_kind_check check (kind in ('home', 'page', 'custom')),
      constraint navigation_items_label_check check (label = btrim(label) and char_length(label) between 1 and 80),
      constraint navigation_items_position_check check (position between 0 and 49),
      constraint navigation_items_target_check check (
        (kind = 'home' and page_id is null and url is null)
        or (kind = 'page' and page_id is not null and url is null)
        or (kind = 'custom' and page_id is null and url is not null)
      ),
      constraint navigation_items_url_check check (
        url is null or (
          url = btrim(url)
          and char_length(url) between 1 and 2048
          and url !~ '[[:space:][:cntrl:]]'
          and strpos(url, chr(92)) = 0
          and (url ~ '^/($|[^/])' or url ~* '^https?://[^/?#]+')
        )
      ),
      constraint navigation_items_page_owner_locale_fkey
        foreign key (page_id, owner_id, locale)
        references pages(id, owner_id, locale) on delete cascade,
      unique (owner_id, locale, location, position)
    );

    create unique index categories_owner_name_key on categories (owner_id, lower(name));
    create unique index categories_one_default_per_owner_key on categories (owner_id) where is_default;
    create index post_category_assignments_category_owner_idx on post_category_assignments (category_id, owner_id);
    create index posts_owner_updated_idx on posts (owner_id, updated_at desc, id);
    create index posts_public_published_idx on posts (locale, published_at desc, id) where status = 'published';
    create index pages_owner_updated_idx on pages (owner_id, updated_at desc, id);
    create index pages_public_published_idx on pages (locale, published_at desc, id) where status = 'published';
    create unique index navigation_items_home_key on navigation_items (owner_id, locale, location) where kind = 'home';
    create unique index navigation_items_page_key on navigation_items (owner_id, locale, location, page_id) where kind = 'page';
    create unique index navigation_items_custom_key on navigation_items (owner_id, locale, location, url) where kind = 'custom';
    create index navigation_items_public_order_idx on navigation_items (owner_id, locale, location, position, id);
  `.execute(db);

  await sql`
    create function tomecms_set_content_timestamps() returns trigger
    language plpgsql as $$
    begin
      new.updated_at = current_timestamp;
      if new.status = 'draft' then
        new.published_at = null;
      elsif tg_op = 'INSERT' or old.status is distinct from 'published' then
        new.published_at = current_timestamp;
      else
        new.published_at = old.published_at;
      end if;
      return new;
    end;
    $$;

    create trigger posts_set_timestamps before insert or update on posts
      for each row execute function tomecms_set_content_timestamps();
    create trigger pages_set_timestamps before insert or update on pages
      for each row execute function tomecms_set_content_timestamps();

    create function tomecms_touch_updated_at() returns trigger
    language plpgsql as $$
    begin
      new.updated_at = current_timestamp;
      return new;
    end;
    $$;

    create trigger categories_touch_updated_at before update on categories
      for each row execute function tomecms_touch_updated_at();
    create trigger navigation_items_touch_updated_at before update on navigation_items
      for each row execute function tomecms_touch_updated_at();

    create function tomecms_protect_category() returns trigger
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

    create trigger categories_protect_identity before update or delete on categories
      for each row execute function tomecms_protect_category();

    create function tomecms_assert_post_group_has_category(target_group_id uuid) returns void
    language plpgsql as $$
    begin
      if exists (select 1 from post_translation_groups where id = target_group_id)
        and not exists (
          select 1 from post_category_assignments where translation_group_id = target_group_id
        )
      then
        raise exception 'Every Post translation group requires a Category.' using errcode = '23514';
      end if;
    end;
    $$;

    create function tomecms_check_post_category_membership() returns trigger
    language plpgsql as $$
    begin
      if tg_table_name = 'post_translation_groups' then
        perform tomecms_assert_post_group_has_category(new.id);
      else
        if tg_op in ('UPDATE', 'DELETE') then
          perform tomecms_assert_post_group_has_category(old.translation_group_id);
        end if;
        if tg_op in ('INSERT', 'UPDATE') then
          perform tomecms_assert_post_group_has_category(new.translation_group_id);
        end if;
      end if;
      return null;
    end;
    $$;

    create constraint trigger post_groups_require_category
      after insert or update on post_translation_groups
      deferrable initially deferred
      for each row execute function tomecms_check_post_category_membership();
    create constraint trigger post_assignments_require_category
      after insert or update or delete on post_category_assignments
      deferrable initially deferred
      for each row execute function tomecms_check_post_category_membership();
  `.execute(db);

  await sql`
    insert into categories (owner_id, name, is_default)
    select owners.owner_id, 'Uncategorized', true
    from (
      select owner_id from site_settings
      union
      select owner_id from post_translation_groups
    ) as owners
    on conflict (owner_id) where is_default do nothing;

    insert into post_category_assignments (translation_group_id, category_id, owner_id)
    select groups.id, categories.id, groups.owner_id
    from post_translation_groups as groups
    join categories on categories.owner_id = groups.owner_id and categories.is_default
    on conflict do nothing;
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`
    drop table navigation_items;
    drop table post_category_assignments;
    drop table posts;
    drop table pages;
    drop table categories;
    drop table post_translation_groups;
    drop table page_translation_groups;
    drop function tomecms_check_post_category_membership();
    drop function tomecms_assert_post_group_has_category(uuid);
    drop function tomecms_protect_category();
    drop function tomecms_touch_updated_at();
    drop function tomecms_set_content_timestamps();
  `.execute(db);
}
