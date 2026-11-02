import { Node } from '@tiptap/core';

import type { EditorDocument, EditorNode } from '../types/cms';
import { UUID } from './editor-video';

export const MAX_POST_LIST_ITEMS = 24;
export const DEFAULT_POST_LIST_LIMIT = 6;
/** All of a block in stored HTML: the sanitizer keeps its class and strips its data. */
export const POST_LIST_PLACEHOLDER = '<div class="tome-post-list"></div>';

export type PostListLayout = 'grid-2' | 'grid-3' | 'list';

/** `postGroupIds` are post translation groups, so each language's page resolves its own edition. */
export interface PostListAttrs {
  source: 'posts' | 'category';
  postGroupIds: string[];
  categoryId: string | null;
  limit: number;
  layout: PostListLayout;
}

const KEYS: ReadonlySet<string> = new Set(['source', 'postGroupIds', 'categoryId', 'limit', 'layout']);
const isLayout = (value: unknown): value is PostListLayout => value === 'grid-2' || value === 'grid-3' || value === 'list';
const isId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

/** The attributes a stored block may have, or null. Whether the ids still name anything is for the reader's page. */
export function postListAttrs(value: unknown): PostListAttrs | null {
  if (!value || typeof value !== 'object' || Object.keys(value).some((key) => !KEYS.has(key))) return null;
  const { source, postGroupIds, categoryId, limit, layout } = value as Record<string, unknown>;
  if (!Array.isArray(postGroupIds) || postGroupIds.length > MAX_POST_LIST_ITEMS || !postGroupIds.every(isId)) return null;
  const groups = postGroupIds.map((id) => id.toLowerCase());
  if (new Set(groups).size !== groups.length) return null;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MAX_POST_LIST_ITEMS) return null;
  if (!isLayout(layout)) return null;
  if (source === 'posts' && categoryId === null) return { source, postGroupIds: groups, categoryId, limit, layout };
  if (source === 'category' && !groups.length && isId(categoryId)) {
    return { source, postGroupIds: groups, categoryId: categoryId.toLowerCase(), limit, layout };
  }
  return null;
}

/** The blocks a page's body holds, in the order the page shows them. */
export function documentPostLists(document: EditorDocument): PostListAttrs[] {
  return (document.content ?? []).flatMap((node) => {
    const attrs = node.type === 'postList' ? postListAttrs(node.attrs) : null;
    return attrs ? [attrs] : [];
  });
}

export function documentHasPostList(node: EditorNode): boolean {
  return node.type === 'postList' || (node.content ?? []).some(documentHasPostList);
}

export const postList = Node.create({
  name: 'postList',
  atom: true,
  draggable: true,

  addAttributes() {
    // Read from the data attribute as a whole by the rule below, so nothing is taken on trust.
    return {
      source: { default: 'posts', rendered: false, parseHTML: () => null },
      postGroupIds: { default: [], rendered: false, parseHTML: () => null },
      categoryId: { default: null, rendered: false, parseHTML: () => null },
      limit: { default: DEFAULT_POST_LIST_LIMIT, rendered: false, parseHTML: () => null },
      layout: { default: 'grid-3', rendered: false, parseHTML: () => null },
    };
  },

  parseHTML() {
    return [{
      tag: 'div.tome-post-list[data-post-list]',
      getAttrs: (element) => {
        try {
          return postListAttrs(JSON.parse(element.getAttribute('data-post-list') ?? '')) ?? false;
        } catch {
          return false;
        }
      },
    }];
  },

  // The data is for the clipboard: a copy inside the editor keeps its block.
  renderHTML({ node }) {
    return ['div', { class: 'tome-post-list', 'data-post-list': JSON.stringify(node.attrs) }];
  },
});

// A block is in no group, so only the document can hold one: a page splits it out of its stored
// HTML by position, which it could not do from inside a quote or a table cell.
export const pageDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: '(block|postList)+',
  // StarterKit's document says this too: without it, a document written as Markdown comes out empty.
  renderMarkdown: (node, helpers) => (node.content ? helpers.renderChildren(node.content, '\n\n') : ''),
});
