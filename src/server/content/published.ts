import { pagePath, postPath } from '../../lib/i18n';
import type {
  Page,
  Post,
  PostAlternate,
  PostCategoryBadge,
  PostLocale,
} from '../../types/cms';
import { db } from '../db/client';
import { pageFromRow } from './pages';
import { postFromRow } from './posts';
import { getSiteSettings } from './settings';

export type PublishedPost = Post;
export type PublishedPage = Page;

export interface PublishedListInput {
  locale?: PostLocale;
  limit?: number;
}

function boundedLimit(value = 1_000): number {
  return Math.min(1_000, Math.max(1, Math.trunc(value)));
}

async function ownerId(): Promise<string | null> {
  return (await getSiteSettings())?.owner_id ?? null;
}

export async function listPublishedPosts(input: PublishedListInput = {}): Promise<PublishedPost[]> {
  const owner = await ownerId();
  if (!owner) return [];
  let query = db.selectFrom('posts').selectAll()
    .where('owner_id', '=', owner)
    .where('status', '=', 'published');
  if (input.locale) query = query.where('locale', '=', input.locale);
  return (await query.orderBy('published_at', 'desc').orderBy('id').limit(boundedLimit(input.limit)).execute())
    .map(postFromRow);
}

export async function getPublishedPost(locale: PostLocale, slug: string): Promise<PublishedPost | null> {
  const owner = await ownerId();
  if (!owner) return null;
  const row = await db.selectFrom('posts').selectAll()
    .where('owner_id', '=', owner)
    .where('locale', '=', locale)
    .where('slug', '=', slug)
    .where('status', '=', 'published')
    .executeTakeFirst();
  return row ? postFromRow(row) : null;
}

export async function listPublishedPages(input: PublishedListInput = {}): Promise<PublishedPage[]> {
  const owner = await ownerId();
  if (!owner) return [];
  let query = db.selectFrom('pages').selectAll()
    .where('owner_id', '=', owner)
    .where('status', '=', 'published');
  if (input.locale) query = query.where('locale', '=', input.locale);
  return (await query.orderBy('published_at', 'desc').orderBy('id').limit(boundedLimit(input.limit)).execute())
    .map(pageFromRow);
}

export async function getPublishedPage(locale: PostLocale, slug: string): Promise<PublishedPage | null> {
  const owner = await ownerId();
  if (!owner) return null;
  const row = await db.selectFrom('pages').selectAll()
    .where('owner_id', '=', owner)
    .where('locale', '=', locale)
    .where('slug', '=', slug)
    .where('status', '=', 'published')
    .executeTakeFirst();
  return row ? pageFromRow(row) : null;
}

export async function listPublishedPostAlternates(translationGroupId: string): Promise<PostAlternate[]> {
  const owner = await ownerId();
  if (!owner) return [];
  const rows = await db.selectFrom('posts').select(['locale', 'slug'])
    .where('owner_id', '=', owner)
    .where('translation_group_id', '=', translationGroupId)
    .where('status', '=', 'published')
    .orderBy('locale')
    .execute();
  return rows.map((row) => ({ href: postPath(row), locale: row.locale }));
}

export async function listPublishedPageAlternates(translationGroupId: string): Promise<PostAlternate[]> {
  const owner = await ownerId();
  if (!owner) return [];
  const rows = await db.selectFrom('pages').select(['locale', 'slug'])
    .where('owner_id', '=', owner)
    .where('translation_group_id', '=', translationGroupId)
    .where('status', '=', 'published')
    .orderBy('locale')
    .execute();
  return rows.map((row) => ({ href: pagePath(row), locale: row.locale }));
}

export async function listPublishedPostCategories(translationGroupId: string): Promise<PostCategoryBadge[]> {
  const owner = await ownerId();
  if (!owner) return [];
  return db.selectFrom('post_category_assignments as assignment')
    .innerJoin('categories as category', (join) => join
      .onRef('category.id', '=', 'assignment.category_id')
      .onRef('category.owner_id', '=', 'assignment.owner_id'))
    .select(['category.id', 'category.name'])
    .where('assignment.owner_id', '=', owner)
    .where('assignment.translation_group_id', '=', translationGroupId)
    .orderBy('category.is_default', 'desc')
    .orderBy('category.name')
    .execute();
}
