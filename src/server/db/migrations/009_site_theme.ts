import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

/**
 * The theme the public site is served in.
 *
 * 'system' is the default and means the reader's own setting decides, which is what
 * the stylesheet already does when no data-theme attribute is present. The other two
 * are the owner overriding that for every visitor.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema.alterTable('site_settings')
    .addColumn('theme', 'text', (column) => column.notNull().defaultTo('system'))
    .execute();
  await db.schema.alterTable('site_settings')
    .addCheckConstraint('site_settings_theme', sql`theme in ('system', 'light', 'dark')`)
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.alterTable('site_settings').dropColumn('theme').execute();
}
