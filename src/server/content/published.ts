import { sql } from 'kysely';
import { pagePath, postPath } from '../../lib/i18n';
import type {
  Page,
  Post,
  PostAlternate,
  PostCategoryBadge,
  PostLocale,
} from '../../types/cms';
import { db } from '../db/client';
import { cursorQueryHash, decodeCursor, encodeCursor, type CursorQuery } from '../http/cursor';
import { listReadyMediaByIds, type ReadyMedia } from '../media/service';
import { listPublishedCategoriesForOwner } from './categories';
import { editorMediaIds } from './editor';
import { pageFromRow } from './pages';
import { postFromRow } from './posts';
import { getSiteSettings, type SiteSettings } from './settings';
import { live } from './live';
export interface PublishedPost extends Post {
  categories: PostCategoryBadge[];
  coverImage: ReadyMedia | null;
  lastModified: Date;
  media: ReadyMedia[];
  translations: PostAlternate[];
}

export interface PublishedPage extends Page {
  lastModified: Date;
  media: ReadyMedia[];
  translations: PostAlternate[];
}

export interface PublicPageListInput {
  cursor?: string;
  limit?: number;
  locale: PostLocale;
}

export interface PublicPostListInput extends PublicPageListInput {
  category?: string;
}

export interface PublishedPageResult<T> {
  hasMore: boolean;
  items: T[];
  lastModified: Date;
  nextCursor: string | null;
}

export interface PublishedSiteResult {
  avatar: ReadyMedia | null;
  lastModified: Date;
  settings: SiteSettings;
}

function boundedLimit(value = 20): number {
  return Math.min(1_000, Math.max(1, Math.trunc(value)));
}

function newer(...values: Array<Date | string | null | undefined>): Date {
  return new Date(Math.max(0, ...values.map((value) => value ? new Date(value).getTime() : 0)));
}

export async function enrichPosts(ownerId: string, posts: Post[]): Promise<PublishedPost[]> {
  if (!posts.length) return [];
  const groupIds = [...new Set(posts.map(({ translation_group_id }) => translation_group_id))];
  const mediaIds = [...new Set(posts.flatMap((post) => [
    ...editorMediaIds(post.content_json),
    ...(post.cover_media_id ? [post.cover_media_id] : []),
  ]))];
  const [categoryRows, translationRows, media] = await Promise.all([
    db.selectFrom('post_category_assignments as assignment')
      .innerJoin('categories as category', (join) => join
        .onRef('category.id', '=', 'assignment.category_id')
        .onRef('category.owner_id', '=', 'assignment.owner_id'))
      .select([
        'assignment.translation_group_id',
        'assignment.created_at as assignment_created_at',
        'category.id',
        'category.name',
        'category.is_default',
        'category.updated_at as category_updated_at',
      ])
      .where('assignment.owner_id', '=', ownerId)
      .where('assignment.translation_group_id', 'in', groupIds)
      .orderBy('assignment.translation_group_id')
      .orderBy('category.is_default', 'desc')
      .orderBy('category.name')
      .orderBy('category.id')
      .execute(),
    db.selectFrom('posts').select(['translation_group_id', 'locale', 'slug', 'updated_at'])
      .where('owner_id', '=', ownerId)
      .where('translation_group_id', 'in', groupIds)
      .where(live('posts'))
      .orderBy('translation_group_id').orderBy('locale').execute(),
    listReadyMediaByIds(ownerId, mediaIds),
  ]);

  const categories = new Map<string, PostCategoryBadge[]>();
  const categoryDates = new Map<string, Date>();
  for (const row of categoryRows) {
    const items = categories.get(row.translation_group_id) ?? [];
    items.push({ id: row.id, name: row.name });
    categories.set(row.translation_group_id, items);
    categoryDates.set(row.translation_group_id, newer(
      categoryDates.get(row.translation_group_id), row.assignment_created_at, row.category_updated_at,
    ));
  }

  const translations = new Map<string, PostAlternate[]>();
  const translationDates = new Map<string, Date>();
  for (const row of translationRows) {
    const items = translations.get(row.translation_group_id) ?? [];
    items.push({ href: postPath(row), locale: row.locale });
    translations.set(row.translation_group_id, items);
    translationDates.set(row.translation_group_id, newer(translationDates.get(row.translation_group_id), row.updated_at));
  }

  const mediaById = new Map(media.map((item) => [item.id, item]));
  return posts.map((post) => {
    const contentMedia = editorMediaIds(post.content_json).sort().flatMap((id) => {
      const item = mediaById.get(id);
      return item ? [item] : [];
    });
    const coverImage = post.cover_media_id ? mediaById.get(post.cover_media_id) ?? null : null;
    return {
      ...post,
      categories: categories.get(post.translation_group_id) ?? [],
      coverImage,
      lastModified: newer(
        post.updated_at,
        categoryDates.get(post.translation_group_id),
        translationDates.get(post.translation_group_id),
        coverImage?.updated_at,
        ...contentMedia.map(({ updated_at }) => updated_at),
      ),
      media: contentMedia,
      translations: translations.get(post.translation_group_id) ?? [],
    };
  });
}

export async function enrichPages(ownerId: string, pages: Page[]): Promise<PublishedPage[]> {
  if (!pages.length) return [];
  const groupIds = [...new Set(pages.map(({ translation_group_id }) => translation_group_id))];
  const mediaIds = [...new Set(pages.flatMap((page) => editorMediaIds(page.content_json)))];
  const [translationRows, media] = await Promise.all([
    db.selectFrom('pages').select(['translation_group_id', 'locale', 'slug', 'updated_at'])
      .where('owner_id', '=', ownerId)
      .where('translation_group_id', 'in', groupIds)
      .where(live('pages'))
      .orderBy('translation_group_id').orderBy('locale').execute(),
    listReadyMediaByIds(ownerId, mediaIds),
  ]);
  const translations = new Map<string, PostAlternate[]>();
  const translationDates = new Map<string, Date>();
  for (const row of translationRows) {
    const items = translations.get(row.translation_group_id) ?? [];
    items.push({ href: pagePath(row), locale: row.locale });
    translations.set(row.translation_group_id, items);
    translationDates.set(row.translation_group_id, newer(translationDates.get(row.translation_group_id), row.updated_at));
  }
  const mediaById = new Map(media.map((item) => [item.id, item]));
  return pages.map((page) => {
    const contentMedia = editorMediaIds(page.content_json).sort().flatMap((id) => {
      const item = mediaById.get(id);
      return item ? [item] : [];
    });
    return {
      ...page,
      lastModified: newer(
        page.updated_at,
        translationDates.get(page.translation_group_id),
        ...contentMedia.map(({ updated_at }) => updated_at),
      ),
      media: contentMedia,
      translations: translations.get(page.translation_group_id) ?? [],
    };
  });
}

export async function listPublishedPosts(input: PublicPostListInput): Promise<PublishedPageResult<PublishedPost>> {
  const settings = await getSiteSettings();
  if (!settings) return { hasMore: false, items: [], lastModified: new Date(0), nextCursor: null };
  const limit = boundedLimit(input.limit);
  const cursorQuery: CursorQuery = { category: input.category, limit, locale: input.locale };
  const cursor = input.cursor ? decodeCursor(input.cursor, { query: cursorQuery, resource: 'posts' }) : null;
  let query = db.selectFrom('posts as post').selectAll('post')
    .where('post.owner_id', '=', settings.owner_id)
    .where('post.locale', '=', input.locale)
    .where(live('post'));
  if (input.category) {
    query = query.where(sql<boolean>`exists (
      select 1
      from post_category_assignments as assignment
      join categories as category
        on category.id = assignment.category_id and category.owner_id = assignment.owner_id
      where assignment.translation_group_id = post.translation_group_id
        and assignment.owner_id = ${settings.owner_id}
        and lower(category.name) = lower(${input.category})
    )`);
  }
  if (cursor) {
    query = query.where(sql<boolean>`(
      date_trunc('milliseconds', post.published_at) < ${cursor.publishedAt}::timestamptz
      or (
        date_trunc('milliseconds', post.published_at) = ${cursor.publishedAt}::timestamptz
        and post.id < ${cursor.id}::uuid
      )
    )`);
  }
  const rows = await query.orderBy(sql`date_trunc('milliseconds', post.published_at)`, 'desc')
    .orderBy('post.id', 'desc').limit(limit + 1).execute();
  const hasMore = rows.length > limit;
  const items = await enrichPosts(settings.owner_id, rows.slice(0, limit).map(postFromRow));
  const last = items.at(-1);
  const nextCursor = hasMore && last?.published_at ? encodeCursor({
    v: 1,
    resource: 'posts',
    queryHash: cursorQueryHash(cursorQuery),
    publishedAt: last.published_at,
    id: last.id,
  }) : null;
  return {
    hasMore,
    items,
    lastModified: newer(settings.updated_at, ...items.map(({ lastModified }) => lastModified)),
    nextCursor,
  };
}

export async function getPublishedPost(locale: PostLocale, slug: string): Promise<PublishedPost | null> {
  const settings = await getSiteSettings();
  if (!settings) return null;
  const row = await db.selectFrom('posts').selectAll()
    .where('owner_id', '=', settings.owner_id)
    .where('locale', '=', locale)
    .where('slug', '=', slug)
    .where(live('posts'))
    .executeTakeFirst();
  return row ? (await enrichPosts(settings.owner_id, [postFromRow(row)]))[0] ?? null : null;
}

export async function listPublishedPages(input: PublicPageListInput): Promise<PublishedPageResult<PublishedPage>> {
  const settings = await getSiteSettings();
  if (!settings) return { hasMore: false, items: [], lastModified: new Date(0), nextCursor: null };
  const limit = boundedLimit(input.limit);
  const cursorQuery: CursorQuery = { limit, locale: input.locale };
  const cursor = input.cursor ? decodeCursor(input.cursor, { query: cursorQuery, resource: 'pages' }) : null;
  let query = db.selectFrom('pages as page').selectAll('page')
    .where('page.owner_id', '=', settings.owner_id)
    .where('page.locale', '=', input.locale)
    .where(live('page'));
  if (cursor) {
    query = query.where(sql<boolean>`(
      date_trunc('milliseconds', page.published_at) < ${cursor.publishedAt}::timestamptz
      or (
        date_trunc('milliseconds', page.published_at) = ${cursor.publishedAt}::timestamptz
        and page.id < ${cursor.id}::uuid
      )
    )`);
  }
  const rows = await query.orderBy(sql`date_trunc('milliseconds', page.published_at)`, 'desc')
    .orderBy('page.id', 'desc').limit(limit + 1).execute();
  const hasMore = rows.length > limit;
  const items = await enrichPages(settings.owner_id, rows.slice(0, limit).map(pageFromRow));
  const last = items.at(-1);
  const nextCursor = hasMore && last?.published_at ? encodeCursor({
    v: 1,
    resource: 'pages',
    queryHash: cursorQueryHash(cursorQuery),
    publishedAt: last.published_at,
    id: last.id,
  }) : null;
  return {
    hasMore,
    items,
    lastModified: newer(settings.updated_at, ...items.map(({ lastModified }) => lastModified)),
    nextCursor,
  };
}

export async function getPublishedPage(locale: PostLocale, slug: string): Promise<PublishedPage | null> {
  const settings = await getSiteSettings();
  if (!settings) return null;
  const row = await db.selectFrom('pages').selectAll()
    .where('owner_id', '=', settings.owner_id)
    .where('locale', '=', locale)
    .where('slug', '=', slug)
    .where(live('pages'))
    .executeTakeFirst();
  return row ? (await enrichPages(settings.owner_id, [pageFromRow(row)]))[0] ?? null : null;
}

export async function getPublishedSite(): Promise<PublishedSiteResult | null> {
  const settings = await getSiteSettings();
  if (!settings) return null;
  const avatar = settings.author_avatar_media_id
    ? (await listReadyMediaByIds(settings.owner_id, [settings.author_avatar_media_id]))[0] ?? null
    : null;
  return { avatar, lastModified: newer(settings.updated_at, avatar?.updated_at), settings };
}

export async function listPublishedCategories(
  locale: PostLocale,
): Promise<{ items: PostCategoryBadge[]; lastModified: Date }> {
  const settings = await getSiteSettings();
  return settings
    ? listPublishedCategoriesForOwner(settings.owner_id, locale, settings.updated_at)
    : { items: [], lastModified: new Date(0) };
}

export async function listPublishedPostAlternates(translationGroupId: string): Promise<PostAlternate[]> {
  const settings = await getSiteSettings();
  if (!settings) return [];
  const rows = await db.selectFrom('posts').select(['locale', 'slug'])
    .where('owner_id', '=', settings.owner_id)
    .where('translation_group_id', '=', translationGroupId)
    .where(live('posts'))
    .orderBy('locale')
    .execute();
  return rows.map((row) => ({ href: postPath(row), locale: row.locale }));
}

export async function listPublishedPageAlternates(translationGroupId: string): Promise<PostAlternate[]> {
  const settings = await getSiteSettings();
  if (!settings) return [];
  const rows = await db.selectFrom('pages').select(['locale', 'slug'])
    .where('owner_id', '=', settings.owner_id)
    .where('translation_group_id', '=', translationGroupId)
    .where(live('pages'))
    .orderBy('locale')
    .execute();
  return rows.map((row) => ({ href: pagePath(row), locale: row.locale }));
}

export async function listPublishedPostCategories(translationGroupId: string): Promise<PostCategoryBadge[]> {
  const settings = await getSiteSettings();
  if (!settings) return [];
  return db.selectFrom('post_category_assignments as assignment')
    .innerJoin('categories as category', (join) => join
      .onRef('category.id', '=', 'assignment.category_id')
      .onRef('category.owner_id', '=', 'assignment.owner_id'))
    .select(['category.id', 'category.name'])
    .where('assignment.owner_id', '=', settings.owner_id)
    .where('assignment.translation_group_id', '=', translationGroupId)
    .orderBy('category.is_default', 'desc')
    .orderBy('category.name')
    .execute();
}
