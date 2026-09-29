import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

/**
 * Whether a post's cover leads the article. Every existing post keeps showing it: the default is
 * true. The home page card and the shared-link image use the cover either way; this only takes it
 * off the top of the article, for a post whose body already opens with the picture.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`alter table posts add column show_cover boolean not null default true`.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`alter table posts drop column show_cover`.execute(db);
}
