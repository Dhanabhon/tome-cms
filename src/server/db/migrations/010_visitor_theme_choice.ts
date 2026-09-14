import type { Kysely } from 'kysely';

import type { Database } from '../types';

/**
 * Whether the public site offers visitors a theme control of their own.
 *
 * Off means more than a hidden button: the inline theme script goes with it, so the
 * owner's theme becomes the only one, a stale choice in somebody's localStorage
 * stops overriding it, and the public pages carry no JavaScript again.
 *
 * Defaults to true because that is the behaviour the site already has.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema.alterTable('site_settings')
    .addColumn('allow_visitor_theme', 'boolean', (column) => column.notNull().defaultTo(true))
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.alterTable('site_settings').dropColumn('allow_visitor_theme').execute();
}
