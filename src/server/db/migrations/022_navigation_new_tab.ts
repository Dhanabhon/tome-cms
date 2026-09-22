import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

/**
 * A menu link the owner typed may open in a new tab. The site's own pages and its home open
 * in place, so only a custom item can have it, and every item there before stays in place.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table navigation_items
      add column new_tab boolean not null default false,
      add constraint navigation_items_new_tab_check check (kind = 'custom' or not new_tab)
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table navigation_items
      drop constraint navigation_items_new_tab_check,
      drop column new_tab
  `.execute(db);
}
