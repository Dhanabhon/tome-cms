import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

/**
 * What each theme has been told, kept per theme.
 *
 * Keyed by theme id rather than flattened into columns, because these are not facts about
 * the site: "six posts a load" is true of a three-column grid and means nothing to a
 * one-column list. Keyed rather than replaced, so switching to another theme and back
 * returns the owner to the choices they made, instead of to the defaults.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema.alterTable('site_settings')
    .addColumn('theme_settings', 'jsonb', (column) => column.notNull().defaultTo(sql`'{}'::jsonb`))
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.alterTable('site_settings').dropColumn('theme_settings').execute();
}
