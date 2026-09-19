import type { Kysely } from 'kysely';

import type { Database } from '../types';

/**
 * Whether the public footer says what the site runs on.
 *
 * A self-hosted CMS that cannot be told to stop naming itself is one the owner edits
 * the theme to silence, so the line is a setting rather than a fixture. It defaults
 * to true: a site that has never been asked shows it.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema.alterTable('site_settings')
    .addColumn('show_powered_by', 'boolean', (column) => column.notNull().defaultTo(true))
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.alterTable('site_settings').dropColumn('show_powered_by').execute();
}
