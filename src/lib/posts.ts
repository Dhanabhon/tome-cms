import type { EditorNode, Post, PostLocale, PostStatus } from '../types/cms';

const BLOCKS = new Set(['blockquote', 'bulletList', 'doc', 'listItem', 'orderedList']);

export function editorText(node: EditorNode): string {
  if (typeof node.text === 'string') return node.text;
  return (node.content ?? []).map(editorText).join(BLOCKS.has(node.type ?? '') ? ' ' : '');
}

export function hasMeaningfulContent(node: EditorNode) {
  if (node.type === 'image') return true;
  if (typeof node.text === 'string' && node.text.trim()) return true;
  return (node.content ?? []).some(hasMeaningfulContent);
}

export function postExcerpt(post: Pick<Post, 'content_json' | 'meta_description'>, fallback: string) {
  if (post.meta_description) return post.meta_description;
  const text = editorText(post.content_json).replace(/\s+/g, ' ').trim();
  return text ? (text.length > 160 ? `${text.slice(0, 157).trimEnd()}…` : text) : fallback;
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
