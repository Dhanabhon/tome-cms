import { editorText } from './editor-content';
import type { EditorNode, Post, PostLocale, PostStatus } from '../types/cms';

export { editorText, hasMeaningfulContent } from './editor-content';

/**
 * What the post tells a search engine about itself.
 *
 * The excerpt is deliberately not in this chain. It is written for a person deciding what
 * to open, and for a while it was in here -- so writing one silently replaced the meta
 * description of the article, which is the exact confusion the excerpt exists to end.
 */
export function postDescription(post: Pick<Post, 'content_json' | 'meta_description'>, fallback: string) {
  if (post.meta_description) return post.meta_description;
  const text = editorText(post.content_json).replace(/\s+/g, ' ').trim();
  return text ? (text.length > 160 ? `${text.slice(0, 157).trimEnd()}…` : text) : fallback;
}

/**
 * The line a reader is shown while deciding: a card, or an entry in a feed reader.
 *
 * The post's own excerpt first, because it is the only one of the three written for that
 * reader. Then what the post tells a search engine, because that is what a card showed
 * before excerpts existed and a site should not lose it by upgrading.
 */
export function postExcerpt(post: Pick<Post, 'content_json' | 'excerpt' | 'meta_description'>, fallback: string) {
  return post.excerpt || postDescription(post, fallback);
}

export function readingMinutes(node: EditorNode) {
  const words = [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(editorText(node))]
    .filter((segment) => segment.isWordLike)
    .length;
  return Math.max(1, Math.ceil(words / 200));
}

export interface AdminPostFilters {
  locale: 'all' | PostLocale;
  query: string;
  status: 'all' | PostStatus;
}

export function filterAdminPosts(posts: Post[], filters: AdminPostFilters) {
  const query = filters.query.trim().toLocaleLowerCase();
  // ponytail: filter one owner's complete list in memory; add DB pagination only when measured volume requires it.
  return posts.filter((post) => (
    (filters.status === 'all' || post.status === filters.status)
    && (filters.locale === 'all' || post.locale === filters.locale)
    && (!query || post.title.toLocaleLowerCase().includes(query))
  ));
}

/** One story, and every language edition of it the owner has written so far. */
export interface AdminStory<T extends StoryEdition> {
  editions: T[];
  groupId: string;
  /** The edition the card is named and pictured by: the owner's own language when it exists. */
  primary: T;
}

interface StoryEdition {
  locale: PostLocale;
  translation_group_id: string;
  updated_at: string;
}

/**
 * Groups a list of editions into the stories they belong to.
 *
 * The filter decides which stories appear; it never hides an edition inside one. A
 * card exists to show that the Thai and the English are two halves of the same thing,
 * and a card that showed only the half you filtered for would be lying about the other.
 */
export function groupAdminStories<T extends StoryEdition>(
  all: T[],
  matching: T[],
  ownerLocale: PostLocale | null,
): AdminStory<T>[] {
  const matched = new Set(matching.map((edition) => edition.translation_group_id));
  const byGroup = new Map<string, T[]>();
  for (const edition of all) {
    if (!matched.has(edition.translation_group_id)) continue;
    const group = byGroup.get(edition.translation_group_id) ?? [];
    group.push(edition);
    byGroup.set(edition.translation_group_id, group);
  }

  const first = ownerLocale ?? 'th';
  const stories = [...byGroup.entries()].map(([groupId, editions]) => {
    const ordered = [...editions].sort((left, right) => (
      Number(right.locale === first) - Number(left.locale === first) || left.locale.localeCompare(right.locale)
    ));
    return { editions: ordered, groupId, primary: ordered[0] };
  });

  // Newest story first, measured by whichever edition was touched most recently.
  return stories.sort((left, right) => (
    latest(right.editions).localeCompare(latest(left.editions))
  ));
}

function latest<T extends StoryEdition>(editions: T[]) {
  return editions.reduce((newest, edition) => (
    edition.updated_at > newest ? edition.updated_at : newest
  ), '');
}
