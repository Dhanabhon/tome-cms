import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

/**
 * The site's own logo, a second one for the dark scheme, and its icon -- and whether the
 * header still says the site's name beside the logo.
 *
 * On the settings row rather than in media_items: the library holds five raster types and
 * checks that it does, and SVG belongs to these three alone. Each is null or an object, and
 * is parsed where it is read (src/lib/site-brand.ts).
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema.alterTable('site_settings')
    .addColumn('brand_logo', 'jsonb', (column) => column.check(sql`brand_logo is null or jsonb_typeof(brand_logo) = 'object'`))
    .addColumn('brand_logo_dark', 'jsonb', (column) => column.check(sql`brand_logo_dark is null or jsonb_typeof(brand_logo_dark) = 'object'`))
    .addColumn('brand_icon', 'jsonb', (column) => column.check(sql`brand_icon is null or jsonb_typeof(brand_icon) = 'object'`))
    .addColumn('hide_site_name', 'boolean', (column) => column.notNull().defaultTo(false))
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.alterTable('site_settings')
    .dropColumn('hide_site_name')
    .dropColumn('brand_icon')
    .dropColumn('brand_logo_dark')
    .dropColumn('brand_logo')
    .execute();
}
