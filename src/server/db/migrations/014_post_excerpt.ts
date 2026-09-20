import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

/**
 * The line a card shows, in the writer's own words.
 *
 * The homepage card was drawing the search description, so the sentence written for a
 * search result was also the one a reader met while deciding what to open -- two different
 * readers served by one field, and changing either one changed the other.
 *
 * 120 characters, because the card clamps to two lines and two lines hold between 76 and
 * 108 characters depending on how wide the grid is: enough for one sentence, not enough
 * for two. Blank keeps the behaviour a site has now, which is why this does not backfill.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema.alterTable('posts')
    .addColumn('excerpt', 'text', (column) => column.notNull().defaultTo(''))
    .execute();
  await sql`alter table posts add constraint posts_excerpt_check
    check (excerpt = btrim(excerpt) and char_length(excerpt) <= 120)`.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`alter table posts drop constraint posts_excerpt_check`.execute(db);
  await db.schema.alterTable('posts').dropColumn('excerpt').execute();
}
