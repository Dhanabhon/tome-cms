import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

/**
 * The picture a shared link shows when the page has no cover of its own.
 *
 * Beside the logos rather than in media_items, as they are: it is the site's, not a post's, and
 * it is stored already cropped to the card LINE, Facebook and X draw, so it is null or an object
 * of the same shape as a logo (src/lib/site-brand.ts).
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema.alterTable('site_settings')
    .addColumn('brand_share', 'jsonb', (column) => column.check(sql`brand_share is null or jsonb_typeof(brand_share) = 'object'`))
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.alterTable('site_settings').dropColumn('brand_share').execute();
}
