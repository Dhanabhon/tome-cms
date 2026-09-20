import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

/**
 * What the owner has switched on, and what they told it.
 *
 * A row per plugin rather than a column per setting: a plugin's fields are the plugin's
 * business, and adding one should not be a migration. Secrets in here are sealed before
 * they arrive; the column holds ciphertext.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema.createTable('plugin_settings')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('owner_id', 'text', (column) => column.notNull().references('user.id').onDelete('cascade'))
    .addColumn('enabled', 'boolean', (column) => column.notNull().defaultTo(false))
    .addColumn('settings', 'jsonb', (column) => column.notNull().defaultTo('{}'))
    .addColumn('updated_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable('plugin_settings').execute();
}
