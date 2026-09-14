import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readRecord } from '../../src/lib/admin-story-list';

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
