import assert from 'node:assert/strict';
import test from 'node:test';

import { MarkdownTooComplexError } from '../../src/server/content/markdown-import';
import { MarkdownBusyError, readMarkdownPost } from '../../src/server/content/markdown-import-run';

// A file that stays inside every limit and still takes seconds: the most the limits allow.
const slow = `${'## h\n'.repeat(3_900)}| a | b |\n| - | - |\n${'| 1 | 2 |\n'.repeat(21_000)}`;

test('a normal file is read in a worker and comes back whole', async () => {
  const post = await readMarkdownPost('---\ntitle: Worker\n---\n\nBody *text*', 'w.md');
  assert.equal(post.title, 'Worker');
  assert.equal(post.document.content?.[0]?.type, 'paragraph');
  assert.deepEqual(post.warnings, []);
});

test('a file the limits refuse is refused the same way from the worker', async () => {
  await assert.rejects(readMarkdownPost('*a '.repeat(39_000), 'a.md'), (error) => error instanceof MarkdownTooComplexError && error.limit === 'emphasis');
});

test('a file that takes longer than the limit is stopped, and the next one is read', async (context) => {
  process.env.TOME_CMS_MARKDOWN_PARSE_LIMIT_MS = '300';
  context.after(() => { delete process.env.TOME_CMS_MARKDOWN_PARSE_LIMIT_MS; });
  const started = performance.now();
  await assert.rejects(readMarkdownPost(slow, 'slow.md'), (error) => error instanceof MarkdownTooComplexError && error.limit === 'time');
  const took = performance.now() - started;
  context.diagnostic(`stopped after ${Math.round(took)} ms`);
  assert.ok(took < 2_000, `took ${Math.round(took)} ms`);
  delete process.env.TOME_CMS_MARKDOWN_PARSE_LIMIT_MS;
  assert.equal((await readMarkdownPost('Body', 'b.md')).title, 'b');
});

test('a second file is turned away while one is being read, and not queued', async () => {
  const first = readMarkdownPost('First', 'first.md');
  await assert.rejects(readMarkdownPost('Second', 'second.md'), MarkdownBusyError);
  assert.equal((await first).title, 'first');
  assert.equal((await readMarkdownPost('Third', 'third.md')).title, 'third', 'the place is free again');
});
