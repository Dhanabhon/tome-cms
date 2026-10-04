import { sql } from 'kysely';

import { db } from '../db/client';

/**
 * What "published" means to a reader: said so, dated, and the date has come.
 *
 * The third part is the whole of a scheduled post. The owner has published it and named a
 * moment; until that moment it is not the public's yet.
 *
 * Written once because every public read has to agree on it. A post that is not on the
 * homepage must not be in the sitemap, the feed, a category's count or an hreflang link
 * either -- and each of those was its own copy of `status = 'published'`, which is how one
 * of them comes to disagree with the others.
 *
 * `now()` is the transaction's clock, so every query in one request answers as of the same
 * instant rather than drifting across the statements that make up a page.
 */
export function live(alias: string) {
  return sql<boolean>`${sql.ref(`${alias}.status`)} = 'published'
    and ${sql.ref(`${alias}.published_at`)} is not null
    and ${sql.ref(`${alias}.published_at`)} <= now()`;
}

/**
 * When the next scheduled post or page goes public, or null when none is waiting.
 *
 * The page cache's one expiry no write announces: a scheduled post appears when its moment comes,
 * and nothing is written then, so a cached home page, feed or sitemap must not outlive it.
 */
export async function nextScheduledPublish(): Promise<Date | null> {
  const result = await sql<{ next: Date | null }>`
    select min(published_at) as next from (
      select published_at from posts where status = 'published' and published_at > now()
      union all
      select published_at from pages where status = 'published' and published_at > now()
    ) as scheduled
  `.execute(db);
  return result.rows[0]?.next ?? null;
}
