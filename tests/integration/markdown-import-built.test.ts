import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

// The Markdown parse runs in a worker with a time limit. A worker needs a file of its own, which
// Astro's bundling does not make, so this runs the BUILT server code (dist/server), where the
// worker is found beside the chunks, and not the source, where it is found another way.
const chunks = 'dist/server/chunks';
const built = existsSync(chunks) ? readdirSync(chunks).find((name) => /^markdown-import-post_.*\.mjs$/.test(name)) : undefined;

test('the built server reads a file in its worker, stops a slow one, and turns a second away', { skip: built ? false : 'Run `npm run build` first: this tests dist/server.' }, async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.ok(existsSync('dist/server/markdown-parse-worker.mjs'), 'the build made the worker file');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  // The build renames what a chunk exports; the functions keep their names.
  const exported = Object.values(await import(pathToFileURL(`${chunks}/${built}`).href) as Record<string, unknown>);
  const previewMarkdownImport = exported.find((value) => typeof value === 'function' && value.name === 'previewMarkdownImport') as
    typeof import('../../src/server/content/markdown-import-post').previewMarkdownImport;
  assert.ok(previewMarkdownImport, 'the built chunk exports the preview');
  context.after(closeDatabase);

  await migrateToLatest();
  await db.insertInto('user').values({ id: 'owner-a', name: 'a', email: 'a@example.invalid', emailVerified: true, image: null, role: 'owner' }).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: 'owner-a', site_name: 'Import', default_locale: 'en', timezone: 'UTC', admin_path: '/admin', author_avatar_media_id: null,
  }).execute();

  const refusal = (warning: unknown, status: number) => (error: unknown) => {
    const refused = error as { name: string; status: number; details?: { warning?: unknown } };
    assert.equal(refused.name, 'HttpError');
    assert.equal(refused.status, status);
    assert.deepEqual(refused.details?.warning, warning);
    return true;
  };

  const normal = await previewMarkdownImport('owner-a', { fileName: 'normal.md', text: '---\ntitle: Built\n---\n\nBody *text*' });
  assert.equal(normal.title, 'Built');

  // A file the limits refuse is refused from the worker, well inside the time a caller waits.
  const started = performance.now();
  await assert.rejects(previewMarkdownImport('owner-a', { fileName: 'bad.md', text: '*a '.repeat(39_000) }), refusal({ code: 'too-complex', limit: 'emphasis' }, 413));
  assert.ok(performance.now() - started < 6_000);

  // The backstop: a file inside every limit that is slow all the same, with the limit lowered for this machine.
  process.env.TOME_CMS_MARKDOWN_PARSE_LIMIT_MS = '300';
  context.after(() => { delete process.env.TOME_CMS_MARKDOWN_PARSE_LIMIT_MS; });
  const slowStart = performance.now();
  await assert.rejects(
    previewMarkdownImport('owner-a', { fileName: 'slow.md', text: `${'## h\n'.repeat(3_900)}${'a b\n'.repeat(21_000)}` }),
    refusal({ code: 'too-complex', limit: 'time' }, 413),
  );
  context.diagnostic(`a slow file stopped after ${Math.round(performance.now() - slowStart)} ms`);
  assert.ok(performance.now() - slowStart < 3_000);
  delete process.env.TOME_CMS_MARKDOWN_PARSE_LIMIT_MS;

  // One at a time: the second is told to wait, not queued; afterwards the place is free.
  const first = previewMarkdownImport('owner-a', { fileName: 'first.md', text: 'First' });
  await assert.rejects(previewMarkdownImport('owner-a', { fileName: 'second.md', text: 'Second' }), refusal({ code: 'busy' }, 429));
  assert.equal((await first).title, 'first');
  assert.equal((await previewMarkdownImport('owner-a', { fileName: 'third.md', text: 'Third' })).title, 'third');
});
