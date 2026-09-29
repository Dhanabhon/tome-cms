import assert from 'node:assert/strict';
import { test } from 'node:test';

import { postReadingMinutes, readingMinutes } from '../../src/lib/posts';

const doc = (words: number) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: Array.from({ length: words }, (_, index) => `word${index}`).join(' ') }] }],
});

test('a post is read in whole minutes at 200 words a minute, and never in less than one', () => {
  assert.equal(readingMinutes(doc(1) as never), 1);
  assert.equal(readingMinutes(doc(401) as never), 3);
});

test('a post is measured once for as long as it is not changed', () => {
  // Segmenting a long Thai post takes milliseconds, and the home page did it for every card on every
  // request: most of what the page cost. An edit changes updated_at, and so the answer.
  const post = { id: 'p1', updated_at: '2026-09-29T10:00:00.000Z', content_json: doc(401) as never };
  assert.equal(postReadingMinutes(post), 3);
  const counted = { ...post, content_json: doc(1) as never };
  assert.equal(postReadingMinutes(counted), 3, 'the same version is not measured again');
  assert.equal(postReadingMinutes({ ...counted, updated_at: '2026-09-29T11:00:00.000Z' }), 1, 'an edit is measured anew');
});
