import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

/**
 * The picture a shared link shows when the page has no cover of its own, and a site description
 * for each language.
 *
 * The picture sits beside the logos rather than in media_items, as they do: it is the site's,
 * not a post's, and it is stored already cropped to the card LINE, Facebook and X draw, so it is
 * null or an object of the same shape as a logo (src/lib/site-brand.ts).
 *
 * The one description a site had was written in its default language, so that is where it goes.
 * site_description stays, and Settings keeps writing the default language's into it: a site
 * taken back to 1.18 still has a description to show.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema.alterTable('site_settings')
    .addColumn('brand_share', 'jsonb', (column) => column.check(sql`brand_share is null or jsonb_typeof(brand_share) = 'object'`))
    .addColumn('site_description_th', 'text', (column) => column.notNull().defaultTo(''))
    .addColumn('site_description_en', 'text', (column) => column.notNull().defaultTo(''))
    .execute();
  await sql`update site_settings set
    site_description_th = case when default_locale = 'th' then site_description else '' end,
    site_description_en = case when default_locale = 'en' then site_description else '' end`.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.alterTable('site_settings')
    .dropColumn('site_description_en')
    .dropColumn('site_description_th')
    .dropColumn('brand_share')
    .execute();
}
