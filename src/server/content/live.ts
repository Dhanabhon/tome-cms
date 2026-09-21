import { sql } from 'kysely';

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
