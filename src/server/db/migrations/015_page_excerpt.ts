import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

/**
 * A page's short line, on the same terms a post's is.
 *
 * Nothing a theme ships renders it yet -- there is no grid of pages the way there is a grid
 * of posts. It is here so a theme that lists or links to pages has a sentence to use that
 * the owner wrote, rather than the one written for a search engine or the page's first
 * words, which is the choice posts had until today.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema.alterTable('pages')
    .addColumn('excerpt', 'text', (column) => column.notNull().defaultTo(''))
    .execute();
  await sql`alter table pages add constraint pages_excerpt_check
    check (excerpt = btrim(excerpt) and char_length(excerpt) <= 120)`.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`alter table pages drop constraint pages_excerpt_check`.execute(db);
  await db.schema.alterTable('pages').dropColumn('excerpt').execute();
}
