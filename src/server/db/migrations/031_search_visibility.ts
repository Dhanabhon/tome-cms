import type { Kysely } from 'kysely';

import type { Database } from '../types';

/**
 * Whether the public site asks search engines and AI crawlers not to list it.
 *
 * Off by default: a site that has never been asked is listed, as it always was. The switch is
 * carried out with noindex on every public answer, never a Disallow in robots.txt -- a crawler
 * that may not fetch a page never reads the noindex on it, and an address already indexed then
 * stays in the results with no text beside it.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema.alterTable('site_settings')
    .addColumn('hide_from_search', 'boolean', (column) => column.notNull().defaultTo(false))
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.alterTable('site_settings').dropColumn('hide_from_search').execute();
}
