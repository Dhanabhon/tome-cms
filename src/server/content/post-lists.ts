import { categoryPath } from '../../lib/i18n';
import { documentPostLists, type PostListAttrs, type PostListLayout, type PostListOption } from '../../lib/editor-post-list';
import { getPublicAuthorProfile } from '../../lib/profile';
import type { EditorDocument, Page, PostLocale } from '../../types/cms';
import type { ThemeHomePost, ThemePageProps } from '../../themes/contract';
import { db } from '../db/client';
import { live } from './live';
import { postFromRow } from './posts';
import { enrichPosts, listPublishedPosts } from './published';
import { getSiteSettings } from './settings';

export interface ResolvedPostList {
  layout: PostListLayout;
  posts: ThemeHomePost[];
  /** The category's own page, when it holds more than the block shows. */
  moreHref: string | null;
}

async function categoryPosts(ownerId: string, locale: PostLocale, attrs: PostListAttrs): Promise<Omit<ResolvedPostList, 'layout'>> {
  const category = attrs.categoryId
    ? await db.selectFrom('categories').select(['name', 'slug', 'is_default'])
      .where('id', '=', attrs.categoryId).where('owner_id', '=', ownerId).executeTakeFirst()
    : undefined;
  if (!category) return { posts: [], moreHref: null };
  // The category page's own read, so the two cannot disagree about what a category holds.
  const { items, hasMore } = await listPublishedPosts({ locale, category: category.name, limit: attrs.limit, take: attrs.limit });
  return { posts: items, moreHref: hasMore && !category.is_default ? categoryPath(locale, category.slug) : null };
}

async function pickedPosts(ownerId: string, locale: PostLocale, attrs: PostListAttrs): Promise<Omit<ResolvedPostList, 'layout'>> {
  if (!attrs.postGroupIds.length) return { posts: [], moreHref: null };
  const rows = await db.selectFrom('posts').selectAll()
    .where('owner_id', '=', ownerId)
    .where('locale', '=', locale)
    .where('translation_group_id', 'in', attrs.postGroupIds)
    .where(live('posts'))
    .execute();
  const byGroup = new Map((await enrichPosts(ownerId, rows.map(postFromRow))).map((post) => [post.translation_group_id, post]));
  // A group without a live edition in this language is skipped.
  return { posts: attrs.postGroupIds.flatMap((group) => byGroup.get(group) ?? []), moreHref: null };
}

// shortcut: a site past 1000 posts sees only the newest 1000 in the picker, and an older chosen post
// reads as missing; move the search to the server when one does.
const OPTIONS_LIMIT = 1000;

/** Every post of a language, by its columns alone: `listPosts` would read whole documents to name them. */
export async function listPostListOptions(ownerId: string, locale: PostLocale): Promise<PostListOption[]> {
  const rows = await db.selectFrom('posts')
    .select(['translation_group_id', 'title', 'status', live('posts').as('is_live')])
    .where('owner_id', '=', ownerId)
    .where('locale', '=', locale)
    .orderBy('updated_at', 'desc')
    .limit(OPTIONS_LIMIT)
    .execute();
  return rows.map((row) => ({
    groupId: row.translation_group_id,
    title: row.title,
    status: row.is_live ? 'published' : row.status === 'published' ? 'scheduled' : 'draft',
  }));
}

/** One entry per block, in the order the page shows them. */
export async function resolvePostLists(document: EditorDocument, locale: PostLocale): Promise<ResolvedPostList[]> {
  const blocks = documentPostLists(document);
  const settings = await getSiteSettings();
  return Promise.all(blocks.map(async (attrs) => ({
    layout: attrs.layout,
    ...(settings
      ? await (attrs.source === 'category' ? categoryPosts : pickedPosts)(settings.owner_id, locale, attrs)
      : { posts: [], moreHref: null }),
  })));
}

/** What a theme's Page needs to draw a page's post lists; nothing, and no query, when it has none. */
export async function pagePostListProps(page: Pick<Page, 'content_json' | 'locale'>): Promise<Pick<ThemePageProps, 'postLists' | 'profile' | 'settings'>> {
  if (!documentPostLists(page.content_json).length) return {};
  const [postLists, settings] = await Promise.all([resolvePostLists(page.content_json, page.locale), getSiteSettings()]);
  if (!settings) return { postLists };
  return {
    postLists,
    profile: await getPublicAuthorProfile(settings, page.locale),
    settings: { site_name: settings.site_name, timezone: settings.timezone },
  };
}
