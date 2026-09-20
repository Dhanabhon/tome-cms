import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pageExcerpt } from '../../src/lib/pages';
import { postDescription, postExcerpt } from '../../src/lib/posts';
import type { EditorDocument } from '../../src/types/cms';

const body = (text: string): EditorDocument => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
} as EditorDocument);

const post = (excerpt: string, metaDescription: string | null, text = 'The opening of the post itself.') =>
  ({ content_json: body(text), excerpt, meta_description: metaDescription });

test('a card shows the line the writer wrote for it', () => {
  assert.equal(postExcerpt(post('A reader decides on this.', 'For a search result.'), ''), 'A reader decides on this.');
});

test('without one, a card keeps showing what it showed before', () => {
  // Every site that has a meta description already has a card drawing it. Putting the
  // excerpt first must not take that away from the posts nobody has revisited.
  assert.equal(postExcerpt(post('', 'For a search result.'), ''), 'For a search result.');
});

test('with neither, the opening of the post, and then the fallback', () => {
  assert.equal(postExcerpt(post('', null), ''), 'The opening of the post itself.');
  assert.equal(postExcerpt(post('', null, ''), 'Nothing yet.'), 'Nothing yet.');
});

test('the opening is cut at a length a card can use, and says it was cut', () => {
  const long = 'word '.repeat(80).trim();
  const shown = postExcerpt(post('', null, long), '');
  assert.ok(shown.length <= 160, `${shown.length} characters`);
  assert.match(shown, /…$/);
});

test('an excerpt is used as written, spaces and all', () => {
  // The field is bounded and trimmed where it is written, not where it is read: a card
  // showing something other than what the editor showed is its own kind of bug.
  const exact = 'a'.repeat(120);
  assert.equal(postExcerpt(post(exact, 'other'), ''), exact);
});

test('an excerpt is never what the post tells a search engine', () => {
  // It was, for about an hour: postExcerpt answered both questions, and <meta name=
  // "description"> on the article page called it. Writing a line for a card silently
  // replaced the line written for a search result -- the exact confusion the field exists
  // to end, rebuilt one level down.
  assert.equal(postDescription(post('A reader decides on this.', 'For a search result.'), ''), 'For a search result.');
  assert.equal(postDescription(post('A reader decides on this.', null), ''), 'The opening of the post itself.');
  assert.equal(postDescription(post('', null, ''), 'Nothing yet.'), 'Nothing yet.');
});

test('a page splits the same two questions the same way', () => {
  const page = { content_json: body('The opening of the page.'), excerpt: 'For a reader.', meta_description: 'For a search result.' };
  assert.equal(pageExcerpt(page, ''), 'For a reader.');
  assert.equal(pageExcerpt({ ...page, excerpt: '' }, ''), 'For a search result.');
  assert.equal(pageExcerpt({ ...page, excerpt: '', meta_description: null }, ''), 'The opening of the page.');
});
