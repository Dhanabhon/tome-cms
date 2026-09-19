import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { apiErrorMessage } from '../../src/lib/admin';
import { readRecord } from '../../src/lib/admin-story-list';
import { adminErrorResponse } from '../../src/server/http/errors';
import { prepareContent } from '../../src/server/content/mutations';

const record = { published_at: '2026-09-14T03:00:00.000Z', status: 'published', updated_at: '2026-09-14T03:00:00.000Z' };

test('reads the record the row needs from a well-formed body', () => {
  assert.deepEqual(readRecord({ post: record }, 'post'), record);
  assert.deepEqual(readRecord({ page: record }, 'page'), record);
});

test('returns null for a body the row cannot be reconciled from', () => {
  // Each of these must fall back to a reload rather than render a stale status.
  assert.equal(readRecord({ page: record }, 'post'), null, 'entity mismatch');
  assert.equal(readRecord({}, 'post'), null, 'missing key');
  assert.equal(readRecord({ post: null }, 'post'), null, 'null record');
  assert.equal(readRecord({ post: 'published' }, 'post'), null, 'non-object record');
  assert.equal(readRecord(null, 'post'), null, 'null body');
  assert.equal(readRecord('published', 'post'), null, 'non-object body');
});

test('rejects a record missing the concurrency token or the status', () => {
  // updated_at is sent back on the next action; without it the row would desync.
  assert.equal(readRecord({ post: { status: 'draft' } }, 'post'), null, 'no updated_at');
  assert.equal(readRecord({ post: { updated_at: record.updated_at } }, 'post'), null, 'no status');
});

const copy = { contentRequired: 'เพิ่มเนื้อหาก่อนเผยแพร่', failed: 'ทำรายการไม่สำเร็จ' };

test('a coded refusal is answered in the owner\'s language, end to end', async () => {
  // Publishing an empty story from the row menu: the API refuses in English, and the list
  // says the same thing in the language the owner is reading. The code is carried through a
  // real error response rather than restated here, so the two halves cannot drift apart.
  let refusal: unknown;
  try {
    prepareContent({ contentJson: { type: 'doc', content: [{ type: 'paragraph' }] }, status: 'published' });
  } catch (error) {
    refusal = error;
  }
  const response = adminErrorResponse(refusal, 'test-request');
  assert.equal(response.status, 400);
  assert.equal(apiErrorMessage(await response.json(), copy), copy.contentRequired);
});

test('anything else is reported as the server sent it', () => {
  // A message written for one refusal must not be shown for another.
  assert.equal(apiErrorMessage({ error: 'That post was changed elsewhere.' }, copy), 'That post was changed elsewhere.');
  assert.equal(apiErrorMessage({ code: 'something_else', error: 'Nope.' }, copy), 'Nope.');
  // A body the list cannot read at all is the one case its own sentence is for.
  assert.equal(apiErrorMessage(null, copy), copy.failed);
  assert.equal(apiErrorMessage('Nope.', copy), copy.failed);
  assert.equal(apiErrorMessage({}, copy), copy.failed);
  assert.equal(apiErrorMessage({ error: 42 }, copy), copy.failed);
});

test('every phrase the list script reads is one the lists actually hand it', () => {
  // The script reads `data.copyContentRequired`; the page writes `data-copy-content-required`.
  // Nothing at build time connects the two, and a mismatch would quietly fall back to English.
  const script = readFileSync(new URL('../../src/lib/admin-story-list.ts', import.meta.url), 'utf8');
  const attributes = [...script.matchAll(/data\.(copy[A-Za-z]+)/g)]
    .map(([, key]) => `data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
  assert.ok(attributes.includes('data-copy-content-required'), 'the refusal is read from the dataset');
  for (const page of ['src/pages/admin/index.astro', 'src/pages/admin/pages/index.astro']) {
    const source = readFileSync(new URL(`../../${page}`, import.meta.url), 'utf8');
    for (const attribute of attributes) assert.ok(source.includes(`${attribute}={`), `${page} is missing ${attribute}`);
  }
});
