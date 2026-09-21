import { db } from '../db/client';
import { pagePath, postPath } from '../../lib/i18n';
import type { PostLocale } from '../../types/cms';
import { live } from './live';

/**
 * Where an address that is not an article's any more should send a reader, if anywhere.
 *
 * Asked only after the address has already failed to find anything, so an article that
 * lives at an address always wins over a redirect that points there.
 *
 * The answer is the article's address now, read at the moment of asking -- the table stores
 * which article, not which address -- and only if a reader may see that article. A redirect
 * to a draft, or to a post whose date has not come, is a redirect to a 404 by another name,
 * and a 404 at the old address says the same thing without a hop.
 */
export async function movedPost(locale: PostLocale, slug: string): Promise<string | null> {
  const row = await db.selectFrom('content_redirects as redirect')
    .innerJoin('posts', 'posts.id', 'redirect.post_id')
    .select(['posts.locale', 'posts.slug'])
    .where('redirect.locale', '=', locale)
    .where('redirect.slug', '=', slug)
    .where(live('posts'))
    .executeTakeFirst();
  return row ? postPath(row) : null;
}

export async function movedPage(locale: PostLocale, slug: string): Promise<string | null> {
  const row = await db.selectFrom('content_redirects as redirect')
    .innerJoin('pages', 'pages.id', 'redirect.page_id')
    .select(['pages.locale', 'pages.slug'])
    .where('redirect.locale', '=', locale)
    .where('redirect.slug', '=', slug)
    .where(live('pages'))
    .executeTakeFirst();
  return row ? pagePath(row) : null;
}
