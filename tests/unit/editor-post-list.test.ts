import assert from 'node:assert/strict';
import test from 'node:test';

import { getSchema } from '@tiptap/core';
import { DOMParser, DOMSerializer, Node } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { createHTMLDocument, parseHTML } from 'zeed-dom';

import { hasMeaningfulContent, hasMeaningfulHtml } from '../../src/lib/editor-content';
import { documentHasPostList, documentPostLists, pageDocument, POST_LIST_PLACEHOLDER, postList, postListAttrs } from '../../src/lib/editor-post-list';
import { prepareEditorContent, ValidationError } from '../../src/server/content/editor';
import type { EditorDocument } from '../../src/types/cms';

const GROUP = '11111111-1111-4111-8111-111111111111';
const CATEGORY = '22222222-2222-4222-8222-222222222222';
const hand = { source: 'posts', postGroupIds: [GROUP], categoryId: null, limit: 6, layout: 'grid-3' };
const whole = { source: 'category', postGroupIds: [], categoryId: CATEGORY, limit: 6, layout: 'list' };

const schema = getSchema([StarterKit.configure({ document: false }), pageDocument, postList]);
const parse = (html: string) => JSON.parse(JSON.stringify(DOMParser.fromSchema(schema).parse(parseHTML(html) as unknown as globalThis.Node).toJSON()));

function serialize(attrs: Record<string, unknown>): string {
  const document = Node.fromJSON(schema, { type: 'doc', content: [{ type: 'postList', attrs }] });
  const fragment = DOMSerializer.fromSchema(schema).serializeFragment(document.content, { document: createHTMLDocument() as unknown as Document });
  return (fragment as unknown as { render(): string }).render();
}

test('postListAttrs keeps a valid block of either source', () => {
  assert.deepEqual(postListAttrs(hand), hand);
  assert.deepEqual(postListAttrs(whole), whole);
});

test('postListAttrs lowercases ids', () => {
  const upper = 'ABCDEFAB-1111-4111-8111-ABCDEFABCDEF';
  assert.deepEqual(postListAttrs({ ...hand, postGroupIds: [upper] })?.postGroupIds, [upper.toLowerCase()]);
  assert.equal(postListAttrs({ ...whole, categoryId: upper })?.categoryId, upper.toLowerCase());
});

test('postListAttrs refuses anything else', () => {
  const upper = 'ABCDEFAB-1111-4111-8111-ABCDEFABCDEF';
  for (const bad of [
    null, 'x', {},
    { ...hand, extra: 1 },
    { ...hand, postGroupIds: ['not-a-uuid'] },
    { ...hand, postGroupIds: [GROUP, GROUP] },
    // The same post in two cases is the same post once stored.
    { ...hand, postGroupIds: [upper, upper.toLowerCase()] },
    { ...hand, postGroupIds: Array.from({ length: 25 }, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`) },
    { ...hand, categoryId: CATEGORY },
    { ...whole, postGroupIds: [GROUP] },
    { ...whole, categoryId: null },
    { ...whole, limit: 0 }, { ...whole, limit: 25 }, { ...whole, limit: 1.5 },
    { ...hand, layout: 'grid-4' },
    { ...hand, source: 'tag' },
  ]) assert.equal(postListAttrs(bad), null, JSON.stringify(bad));
});

test('stored HTML is only the placeholder', () => {
  const { contentHtml } = prepareEditorContent({ contentJson: { type: 'doc', content: [{ type: 'postList', attrs: hand }] } });
  assert.equal(contentHtml, POST_LIST_PLACEHOLDER);
});

test('a stored block keeps exactly its allowed attrs', () => {
  const stored = prepareEditorContent({ contentJson: { type: 'doc', content: [{ type: 'postList', attrs: { ...whole, categoryId: CATEGORY.toUpperCase() } }] } });
  assert.deepEqual(stored.contentJson.content?.[0]?.attrs, whole);
  assert.throws(() => prepareEditorContent({ contentJson: { type: 'doc', content: [{ type: 'postList', attrs: { ...hand, extra: 'x' } }] } }), ValidationError);
});

test('a nested block is refused', () => {
  const nested = { type: 'doc', content: [{ type: 'blockquote', content: [{ type: 'postList', attrs: hand }] }] };
  assert.throws(() => prepareEditorContent({ contentJson: nested }), ValidationError);
});

test('the clipboard form round-trips through parseHTML', () => {
  for (const attrs of [hand, whole]) assert.deepEqual(parse(serialize(attrs)).content?.[0], { type: 'postList', attrs });
});

test('a placeholder without its data makes no block', () => {
  assert.equal(JSON.stringify(parse(POST_LIST_PLACEHOLDER)).includes('postList'), false);
});

test('a paste whose data is not a block makes none', () => {
  for (const data of ['not json', '{}', JSON.stringify({ ...hand, extra: 1 })]) {
    const element = parseHTML('<div class="tome-post-list"></div>').firstChild as unknown as { setAttribute(name: string, value: string): void; render(): string };
    element.setAttribute('data-post-list', data);
    assert.equal(JSON.stringify(parse(element.render())).includes('postList'), false, data);
  }
});

test('a block counts as content', () => {
  assert.equal(hasMeaningfulContent({ type: 'doc', content: [{ type: 'postList', attrs: hand }] }), true);
  assert.equal(hasMeaningfulHtml(POST_LIST_PLACEHOLDER), true);
});

test('documentPostLists returns top-level blocks in order', () => {
  const document: EditorDocument = {
    type: 'doc',
    content: [{ type: 'postList', attrs: hand }, { type: 'paragraph' }, { type: 'postList', attrs: whole }],
  };
  assert.deepEqual(documentPostLists(document), [hand, whole]);
  assert.deepEqual(documentPostLists({ type: 'doc', content: [{ type: 'paragraph' }] }), []);
});

test('documentHasPostList looks at any depth', () => {
  assert.equal(documentHasPostList({ type: 'doc', content: [{ type: 'paragraph' }] }), false);
  assert.equal(documentHasPostList({ type: 'doc', content: [{ type: 'blockquote', content: [{ type: 'postList', attrs: hand }] }] }), true);
});
