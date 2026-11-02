import { categoryPath } from '../../lib/i18n';
import { documentPostLists, type PostListAttrs, type PostListLayout } from '../../lib/editor-post-list';
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
