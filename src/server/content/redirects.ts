import { sql } from 'kysely';

import { db } from '../db/client';
import { HttpError } from '../http/errors';
import { SLUG } from '../../lib/slug';
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

export interface RedirectEntry {
  createdAt: string;
  /** The old address. */
  from: string;
  kind: 'page' | 'post';
  /** Whether a reader following it arrives anywhere today. */
  live: boolean;
  locale: PostLocale;
  slug: string;
  targetId: string;
  targetTitle: string;
  /** Where the article is now. */
  to: string;
}

/**
 * Every forwarding address this owner has, newest first.
 *
 * Including the ones that lead nowhere today -- an unpublished article, a post whose date has
 * not come. They are the owner's to see, and a list that hid them would hide the reason an
 * old link is answering 404.
 */
export async function listRedirects(ownerId: string): Promise<RedirectEntry[]> {
  const [posts, pages] = await Promise.all([
    db.selectFrom('content_redirects as redirect')
      .innerJoin('posts as target', 'target.id', 'redirect.post_id')
      .select(['redirect.locale', 'redirect.slug', 'redirect.created_at', 'target.id', 'target.title',
        'target.locale as targetLocale', 'target.slug as targetSlug', live('target').as('live')])
      .where('target.owner_id', '=', ownerId)
      .execute(),
    db.selectFrom('content_redirects as redirect')
      .innerJoin('pages as target', 'target.id', 'redirect.page_id')
      .select(['redirect.locale', 'redirect.slug', 'redirect.created_at', 'target.id', 'target.title',
        'target.locale as targetLocale', 'target.slug as targetSlug', live('target').as('live')])
      .where('target.owner_id', '=', ownerId)
      .execute(),
  ]);
  const entry = (kind: 'page' | 'post', path: typeof postPath) => (row: (typeof posts)[number]): RedirectEntry => ({
    createdAt: row.created_at.toISOString(),
    from: path({ locale: row.locale, slug: row.slug }),
    kind,
    live: row.live,
    locale: row.locale,
    slug: row.slug,
    targetId: row.id,
    targetTitle: row.title,
    to: path({ locale: row.targetLocale, slug: row.targetSlug }),
  });
  return [...posts.map(entry('post', postPath)), ...pages.map(entry('page', pagePath))]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

/** Stops forwarding one old address. Scoped through the article, which is what the owner owns. */
export async function deleteRedirect(
  ownerId: string,
  input: { kind: 'page' | 'post'; locale: PostLocale; slug: string },
): Promise<void> {
  const owned = input.kind === 'post'
    ? db.selectFrom('posts').select('id').where('owner_id', '=', ownerId)
    : db.selectFrom('pages').select('id').where('owner_id', '=', ownerId);
  const removed = await db.deleteFrom('content_redirects')
    .where('locale', '=', input.locale)
    .where('slug', '=', input.slug)
    .where(input.kind === 'post' ? 'post_id' : 'page_id', 'in', owned)
    .executeTakeFirst();
  if (!removed.numDeletedRows) throw new HttpError(404, 'That address is not forwarded.', { code: 'redirect_unknown' });
}

/**
 * Points an old address at an article by hand.
 *
 * For an address that changed before forwarding was recorded, which the table cannot know
 * about, or one the owner wants sent somewhere new. The address is taken in the article's own
 * language, because that is the only place it can have lived.
 */
export async function addRedirect(
  ownerId: string,
  input: { kind: 'page' | 'post'; slug: string; targetId: string },
): Promise<void> {
  const slug = input.slug.trim().normalize('NFC');
  if (!SLUG.test(slug)) {
    throw new HttpError(400, 'An address is lowercase letters, Thai, digits and single hyphens.', { code: 'redirect_slug_invalid' });
  }
  const table = input.kind === 'post' ? 'posts' : 'pages';
  const target = await db.selectFrom(table).select(['id', 'locale'])
    .where('id', '=', input.targetId).where('owner_id', '=', ownerId).executeTakeFirst();
  if (!target) throw new HttpError(404, 'That article was not found.', { code: 'redirect_target_unknown' });

  // An address something lives at is that thing's, and a redirect there would never be
  // followed -- the live article is always found first. Refused rather than stored unused.
  const occupied = await db.selectFrom(table).select('id')
    .where('locale', '=', target.locale).where('slug', '=', slug).executeTakeFirst();
  if (occupied) throw new HttpError(409, 'Something already lives at that address.', { code: 'redirect_slug_taken' });

  const column = input.kind === 'post' ? 'post_id' : 'page_id';
  await db.insertInto('content_redirects')
    .values({ locale: target.locale, slug, [column]: target.id })
    .onConflict((conflict) => conflict.columns(['locale', 'slug']).where(column, 'is not', null)
      .doUpdateSet({ [column]: target.id, created_at: sql<Date>`current_timestamp` }))
    .execute();
}
