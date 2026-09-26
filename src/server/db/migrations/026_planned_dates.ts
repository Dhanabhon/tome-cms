import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

/**
 * The date a draft is planned to go out on.
 *
 * 017 keeps `published_at` empty on a draft, and that is still right: a draft is not out,
 * and every query that asks "is it out, and since when" reads that column, as 019's
 * redirects do. But it meant the "Publish at" an owner chose on a draft was dropped by the
 * save that filed it, and was gone the next time the editor opened. The plan gets a column
 * of its own. Only a draft carries one; publishing spends it.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table posts
      add column planned_at timestamptz,
      add constraint posts_planned_at_draft_check check (status = 'draft' or planned_at is null)
  `.execute(db);
  await sql`
    alter table pages
      add column planned_at timestamptz,
      add constraint pages_planned_at_draft_check check (status = 'draft' or planned_at is null)
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`alter table posts drop constraint posts_planned_at_draft_check, drop column planned_at`.execute(db);
  await sql`alter table pages drop constraint pages_planned_at_draft_check, drop column planned_at`.execute(db);
}
