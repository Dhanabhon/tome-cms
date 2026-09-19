import type { Kysely } from 'kysely';

import type { Database } from '../types';

/**
 * Which theme draws the public site.
 *
 * Text rather than an enum: themes ship and are dropped with releases, and a check
 * constraint would turn removing one into a migration that has to guess what the owner
 * chose. The renderer answers an id it does not know with the default instead.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema.alterTable('site_settings')
    .addColumn('theme_id', 'text', (column) => column.notNull().defaultTo('paper'))
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.alterTable('site_settings').dropColumn('theme_id').execute();
}
