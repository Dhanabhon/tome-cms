import { sql } from 'kysely';

import type { Page, Post, PostLocale, PostStatus } from '../../types/cms';
import { db } from '../db/client';
import { whileSearching } from '../http/search-limit';
import { getPage } from '../content/pages';
import { getPost } from '../content/posts';
import { READABLE_TEXT } from '../content/published';
import { likeContaining, searchTerms } from '../content/search';
import { listMedia } from '../media/service';
import { McpInputError } from './markdown-in';
import type { ContentKind } from './snapshots';

/**
 * The reads the MCP tools make, over one owner's posts and pages, drafts included. Plain rows in,
 * plain objects out; the tools decide how they are said.
 */

export interface ContentSummary {
  kind: ContentKind;
  id: string;
  title: string;
  slug: string;
  locale: PostLocale;
  status: PostStatus;
  publishedAt: string | null;
  plannedAt: string | null;
  updatedAt: string;
  /** The other-language editions of the same piece. */
  translations: { id: string; locale: PostLocale }[];
}

// Posts and pages share every column read here, so one query serves both. The cast names pages
// as posts for the type checker only; nothing post-only is selected.
const table = (kind: ContentKind) => (kind === 'post' ? 'posts as post' : 'pages as post') as 'posts as post';
const SUMMARY = ['post.id', 'post.title', 'post.slug', 'post.locale', 'post.status', 'post.published_at', 'post.planned_at', 'post.updated_at', 'post.translation_group_id'] as const;
type SummaryRow = { id: string; title: string; slug: string; locale: PostLocale; status: PostStatus; published_at: Date | null; planned_at: Date | null; updated_at: Date; translation_group_id: string };

async function summaries(ownerId: string, kind: ContentKind, rows: SummaryRow[]): Promise<ContentSummary[]> {
  const groups = [...new Set(rows.map((row) => row.translation_group_id))];
  const siblings = groups.length
    ? await db.selectFrom(table(kind)).select(['post.id', 'post.locale', 'post.translation_group_id'])
      .where('post.owner_id', '=', ownerId).where('post.translation_group_id', 'in', groups).execute()
    : [];
  return rows.map((row) => ({
    kind,
    id: row.id,
    title: row.title,
    slug: row.slug,
    locale: row.locale,
    status: row.status,
    publishedAt: row.published_at?.toISOString() ?? null,
    plannedAt: row.planned_at?.toISOString() ?? null,
    updatedAt: row.updated_at.toISOString(),
    translations: siblings.filter((sibling) => sibling.translation_group_id === row.translation_group_id && sibling.id !== row.id)
      .map(({ id, locale }) => ({ id, locale })),
  }));
}

function decodeCursor(cursor: string): { updatedAt: string; id: string } {
  const [updatedAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!updatedAt || !id || Number.isNaN(Date.parse(updatedAt)) || !/^[0-9a-f-]{36}$/.test(id)) {
    throw new McpInputError('That cursor is not one this tool gave. Start again without it.');
  }
  return { updatedAt, id };
}

/** Newest change first, with a cursor for the next page. */
export async function listContent(
  ownerId: string,
  kind: ContentKind,
  { locale, status, cursor, limit = 20 }: { locale?: PostLocale; status?: PostStatus; cursor?: string; limit?: number },
): Promise<{ items: ContentSummary[]; nextCursor: string | null }> {
  // Milliseconds, as the cursor carries them: the column keeps microseconds.
  const changed = sql<Date>`date_trunc('milliseconds', post.updated_at)`;
  let query = db.selectFrom(table(kind)).select(SUMMARY).where('post.owner_id', '=', ownerId);
  if (locale) query = query.where('post.locale', '=', locale);
  if (status) query = query.where('post.status', '=', status);
  if (cursor) {
    const after = decodeCursor(cursor);
    query = query.where(sql<boolean>`(${changed} < ${after.updatedAt}::timestamptz
      or (${changed} = ${after.updatedAt}::timestamptz and post.id > ${after.id}::uuid))`);
  }
  const rows = await query.orderBy(changed, 'desc').orderBy('post.id').limit(limit + 1).execute();
  const items = await summaries(ownerId, kind, rows.slice(0, limit));
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last ? Buffer.from(`${last.updatedAt}|${last.id}`).toString('base64url') : null,
  };
}

/** Words in the title, the excerpt or the body as a reader reads it: the same matching as the public search. */
export async function searchContent(
  ownerId: string,
  { query, kind, locale, status = 'any', limit = 20 }: { query: string; kind?: ContentKind; locale?: PostLocale; status?: PostStatus | 'any'; limit?: number },
): Promise<ContentSummary[]> {
  const terms = searchTerms(query);
  if (!terms.length) throw new McpInputError('Give at least one word to search for.');
  const found: ContentSummary[] = [];
  for (const each of kind ? [kind] : (['post', 'page'] as const)) {
    let select = db.selectFrom(table(each)).select(SUMMARY).where('post.owner_id', '=', ownerId)
      .where(sql<boolean>`(post.title || chr(10) || post.excerpt || chr(10) || ${READABLE_TEXT}) ilike all (${terms.map(likeContaining)}::text[])`);
    if (locale) select = select.where('post.locale', '=', locale);
    if (status !== 'any') select = select.where('post.status', '=', status);
    const rows = await whileSearching(() => select.orderBy('post.updated_at', 'desc').limit(limit).execute());
    found.push(...await summaries(ownerId, each, rows));
  }
  return found.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, limit);
}

/** One post or page, by its id or by its language and slug. */
export async function getContent(
  ownerId: string,
  kind: ContentKind,
  by: { id: string } | { locale: PostLocale; slug: string },
): Promise<Post | Page | null> {
  let id: string | undefined;
  if ('id' in by) id = by.id;
  else {
    id = (await db.selectFrom(table(kind)).select('post.id').where('post.owner_id', '=', ownerId)
      .where('post.locale', '=', by.locale).where('post.slug', '=', by.slug).executeTakeFirst())?.id;
  }
  if (!id) return null;
  return kind === 'post' ? getPost(ownerId, id) : getPage(ownerId, id);
}

/** Pictures in the library: what an AI needs to place one, and nothing else of the row. */
export async function listOwnerMedia(ownerId: string, { search = '', cursor }: { search?: string; cursor?: string }) {
  const page = cursor ? Number(cursor) : 1;
  if (!Number.isInteger(page) || page < 1 || page > 10_000) throw new McpInputError('That cursor is not one this tool gave. Start again without it.');
  const found = await listMedia(ownerId, { page, search, type: 'image' });
  return {
    items: found.items.map((item) => ({ id: item.id, name: item.original_name, alt: item.alt_text, width: item.width, height: item.height, url: item.publicUrl })),
    nextCursor: found.hasMore ? String(page + 1) : null,
  };
}
