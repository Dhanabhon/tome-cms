import { sql, type Kysely } from 'kysely';

import { contentSlug } from '../../../lib/slug';
import type { Database } from '../types';

/**
 * Smaller copies of an image, and an address and a description for each category.
 *
 * A variant is its own object and row beside the original, which keeps its key and size: a site
 * taken back to 1.19 still serves every image it had. The widths are the three the site makes.
 *
 * A category's slug is what its name gives under the same rules as a post's (contentSlug, so Thai
 * names get Thai addresses), made in a loop here rather than in SQL so the database and the app
 * cannot disagree about a slug. Two names that give one slug, under one owner, take -2, -3 and so
 * on in the order the categories were made; a name with nothing to slug gets `category-` and the
 * start of its id. A category inserted without a slug gets that same fallback from a trigger, so
 * the places that create categories (the installer, import, the admin) keep working until each
 * names a slug of its own; the trigger is a floor, not the way a slug is made. This file imports only slug.ts, which needs no configuration: the updater
 * loads every migration in a bare image to list them.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table media_variants (
      media_id uuid not null references media_items(id) on delete cascade,
      width int not null check (width in (480, 960, 1600)),
      object_key text not null unique,
      size_bytes int not null,
      created_at timestamptz not null default now(),
      primary key (media_id, width)
    )
  `.execute(db);

  await sql`
    alter table categories
      add column slug text,
      add column description_th text not null default '',
      add column description_en text not null default ''
  `.execute(db);

  const { rows } = await sql<{ id: string; owner_id: string; name: string }>`
    select id, owner_id, name from categories order by created_at, id
  `.execute(db);
  const taken = new Set<string>();
  // Uncategorized is protected from every update, this one included.
  await sql`alter table categories disable trigger categories_protect_identity`.execute(db);
  for (const { id, owner_id, name } of rows) {
    const base = contentSlug(name) || `category-${id.replaceAll('-', '').slice(0, 8)}`;
    let slug = base;
    for (let suffix = 2; taken.has(`${owner_id}\0${slug}`); suffix += 1) slug = `${base}-${suffix}`;
    taken.add(`${owner_id}\0${slug}`);
    await sql`update categories set slug = ${slug} where id = ${id}`.execute(db);
  }

  await sql`alter table categories enable trigger categories_protect_identity`.execute(db);

  await sql`alter table categories alter column slug set not null`.execute(db);
  await sql`create unique index categories_owner_slug_key on categories (owner_id, slug)`.execute(db);
  await sql`
    create function tomecms_category_slug_fallback() returns trigger
    language plpgsql as $$
    begin
      new.slug := coalesce(new.slug, 'category-' || left(replace(new.id::text, '-', ''), 8));
      return new;
    end;
    $$;

    create trigger categories_slug_fallback before insert on categories
      for each row execute function tomecms_category_slug_fallback();
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`
    drop trigger categories_slug_fallback on categories;
    drop function tomecms_category_slug_fallback();
    drop index categories_owner_slug_key;
    alter table categories
      drop column description_en,
      drop column description_th,
      drop column slug;
    drop table media_variants;
  `.execute(db);
}
