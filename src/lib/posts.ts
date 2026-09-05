import type { EditorNode, Post } from '../types/cms';

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
