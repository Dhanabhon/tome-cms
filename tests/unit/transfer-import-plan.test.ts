import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { ArchiveInputError, writeFrontMatter, type FrontMatter } from '../../src/server/transfer/archive-format';
import { buildPlan, planImport, type SiteReader } from '../../src/server/transfer/import-plan';

const OWNER = '11111111-1111-4111-8111-111111111111';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const OTHER_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 4, 5, 6, 7]);
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('base64');

/** A site with `taken` slugs, the default category and Baking, and one picture already in its library. */
function site(taken: string[] = []): SiteReader {
  return {
    takenSlugs: async (kind, locale, slugs) => new Set(slugs.filter((slug) => taken.includes(`${kind}s/${locale}/${slug}`))),
    categories: async () => [
      { id: 'default-id', name: 'Uncategorized', is_default: true },
      { id: 'baking-id', name: 'Baking', is_default: false },
    ],
    media: async (_owner, checksums) => checksums.includes(sha(PNG))
      ? [{ id: 'existing-picture', checksum_sha256: sha(PNG), size_bytes: String(PNG.length) }]
      : [],
  };
}

async function archive(context: TestContext, files: Record<string, string | Buffer>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'tomecms-import-plan-'));
  context.after(() => rm(root, { force: true, recursive: true }));
  for (const [path, data] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), data);
  }
  return root;
}

function md(fields: Partial<FrontMatter> & { title: string }, body = 'Words.\n'): string {
  const base = { slug: 'x', language: 'en', status: 'draft', updated: '2026-10-01T00:00:00.000Z', excerpt: '', translation: 't' } as const;
  return `${writeFrontMatter({ ...base, ...fields } as FrontMatter)}\n${body}`;
}

test('a slug taken in the same language is skipped, and the same slug in the other language is created', async (context) => {
  const root = await archive(context, {
    'posts/en/bread.md': md({ title: 'Bread', slug: 'bread', language: 'en', translation: 'g1' }),
    'posts/th/bread.md': md({ title: 'ขนมปัง', slug: 'bread', language: 'th', translation: 'g1' }),
  });
  const plan = await planImport(root, OWNER, site(['posts/en/bread']));
  assert.deepEqual(plan.create, [{ kind: 'post', locale: 'th', slug: 'bread', path: 'posts/th/bread.md', source: 'md' }]);
  assert.deepEqual(plan.skip, [{ path: 'posts/en/bread.md', reason: 'slug_taken' }]);
  assert.deepEqual(plan.groupsSplit, [{ translation: 'g1', skipped: ['posts/en/bread.md'] }], 'the group a skip split');
});

test('media already in the library are reused by their SHA-256 and size; the rest are uploaded', async (context) => {
  const root = await archive(context, {
    'posts/en/a.md': md({ title: 'A', slug: 'a', cover: '../../media/one.png' }, '![x](../../media/two.png)\n'),
    'media/one.png': PNG,
    'media/two.png': OTHER_PNG,
  });
  const plan = await planImport(root, OWNER, site());
  assert.deepEqual(plan.media, { upload: 1, reuse: 1 });
});

test('Uncategorized is the default category, names match ignoring case, and a group asks for the union of its lists', async (context) => {
  const root = await archive(context, {
    'posts/en/a.md': md({ title: 'A', slug: 'a', categories: ['uncategorized', 'baking', 'Bread'], translation: 'g' }),
    'posts/th/a.md': md({ title: 'ก', slug: 'a', language: 'th', categories: ['ขนม', 'BREAD'], translation: 'g' }),
  });
  const plan = await planImport(root, OWNER, site());
  assert.deepEqual(plan.categoriesToCreate, ['Bread', 'ขนม']);
  assert.equal(plan.create.length, 2);
  assert.deepEqual(plan.groupsSplit, []);
});

test("the archive's default category is the site's, whatever either is called, and the site's keeps its name", async (context) => {
  const renamed: SiteReader = { ...site(), categories: async () => [
    { id: 'default-id', name: 'ไม่มีหมวดหมู่', is_default: true },
    { id: 'general-id', name: 'General', is_default: false },
  ] };
  const manifest = (defaultCategory?: string) => JSON.stringify({
    format: 'tomecms-markdown', version: 1, createdAt: '2026-10-07T00:00:00.000Z', applicationVersion: '1.21.0',
    publicUrl: 'https://example.invalid', counts: { posts: 1, pages: 0, media: 0 }, media: {}, categories: [],
    ...(defaultCategory ? { defaultCategory } : {}),
  });
  // An archive from before 1.21, or without a manifest: its default was always called Uncategorized.
  for (const files of [{}, { 'manifest.json': manifest() }] as Array<Record<string, string>>) {
    const root = await archive(context, { ...files, 'posts/en/a.md': md({ title: 'A', slug: 'a', categories: ['Uncategorized'] }) });
    assert.deepEqual((await planImport(root, OWNER, renamed)).categoriesToCreate, []);
  }
  // A renamed one says its name, which here is another category's on this site: it is still the default.
  const root = await archive(context, {
    'manifest.json': manifest('General'),
    'posts/en/a.md': md({ title: 'A', slug: 'a', categories: ['general'] }),
  });
  const { plan, detail } = await buildPlan(root, OWNER, renamed);
  assert.deepEqual(plan.categoriesToCreate, []);
  assert.equal(detail.categories.get('general'), 'default-id');
  // To a site whose default is still Uncategorized, likewise.
  assert.deepEqual((await planImport(root, OWNER, site())).categoriesToCreate, []);
});

test('an exact .tome.json is preferred to its .md', async (context) => {
  const root = await archive(context, {
    'pages/en/about.md': md({ title: 'About', slug: 'about' }),
    'pages/en/about.tome.json': JSON.stringify({ type: 'doc', content: [] }),
  });
  const plan = await planImport(root, OWNER, site());
  assert.deepEqual(plan.create, [{ kind: 'page', locale: 'en', slug: 'about', path: 'pages/en/about.md', source: 'tome.json' }]);
});

test('anything outside the layout, a bad front matter and an oversized picture refuse the whole input, naming the file', async (context) => {
  const refused = async (files: Record<string, string | Buffer>, code: string, file: string) => {
    const root = await archive(context, files);
    await assert.rejects(planImport(root, OWNER, site()),
      (error) => error instanceof ArchiveInputError && error.code === code && error.file === file, `${code} ${file}`);
  };
  await refused({ 'notes.txt': 'hi' }, 'layout_invalid', 'notes.txt');
  await refused({ 'posts/fr/a.md': md({ title: 'A' }) }, 'layout_invalid', 'posts/fr');
  await refused({ 'posts/en/deep/a.md': md({ title: 'A' }) }, 'layout_invalid', 'posts/en/deep');
  await refused({ 'posts/en/a.tome.json': '{}' }, 'layout_invalid', 'posts/en/a.tome.json');
  await refused({ 'posts/en/a.md': '---\ntitle: A\nstatus: live\n---\n' }, 'front_matter_invalid', 'posts/en/a.md');
  await refused({ 'posts/en/a.md': md({ title: 'A', language: 'th' }) }, 'front_matter_invalid', 'posts/en/a.md');
  await assert.rejects(planImport(await archive(context, { 'posts/en/a.md': md({ title: 'A', language: 'th' }) }), OWNER, site()),
    (error) => error instanceof ArchiveInputError && error.field === 'language', 'the refusal names the field');
  await assert.rejects(planImport(await archive(context, { 'posts/en/a.md': md({ title: 'A', categories: ['  '] }) }), OWNER, site()),
    (error) => error instanceof ArchiveInputError && error.code === 'front_matter_invalid' && error.field === 'categories');
  await assert.rejects(planImport(await archive(context, {
    'posts/en/a.md': md({ title: 'A', slug: 'a', translation: 'g' }),
    'posts/en/b.md': md({ title: 'B', slug: 'b', translation: 'g' }),
  }), OWNER, site()), (error) => error instanceof ArchiveInputError && error.file === 'posts/en/b.md' && error.field === 'translation');
  await refused({ 'posts/en/a.md': md({ title: 'A' }), 'posts/en/a.tome.json': '{not json' }, 'content_invalid', 'posts/en/a.tome.json');
  await refused({ 'posts/en/a.md': md({ title: 'A' }), 'posts/en/a.tome.json': '{"type":"doc","content":"words"}' }, 'content_invalid', 'posts/en/a.tome.json');
  const huge = Buffer.alloc(9 * 1024 * 1024);
  PNG.copy(huge);
  await refused({ 'media/big.png': huge }, 'media_too_large', 'media/big.png');
  await refused({ 'media/notes.exe': 'MZ' }, 'media_type_unsupported', 'media/notes.exe');

  const linked = await archive(context, { 'posts/en/a.md': md({ title: 'A' }) });
  await symlink(join(linked, 'posts/en/a.md'), join(linked, 'posts/en/b.md'));
  await assert.rejects(planImport(linked, OWNER, site()),
    (error) => error instanceof ArchiveInputError && error.code === 'layout_invalid' && error.file === 'posts/en/b.md', 'a link is not followed');
});

test('the plan checks the slug the write stores: an empty one, or a file name with no words, falls back to the title', async (context) => {
  const root = await archive(context, {
    'posts/en/a.md': '---\ntitle: Hello There\nslug: ""\n---\nWords.\n',
    'posts/en/!!!.md': '---\ntitle: Rye Bread\n---\nWords.\n',
    'posts/en/c.md': '---\ntitle: New One\nslug: ""\n---\nWords.\n',
  });
  const plan = await planImport(root, OWNER, site(['posts/en/hello-there', 'posts/en/rye-bread']));
  assert.deepEqual(plan.skip.map(({ path }) => path).sort(), ['posts/en/!!!.md', 'posts/en/a.md']);
  assert.deepEqual(plan.create.map(({ slug }) => slug), ['new-one']);
});

test('an item file over its bound is refused by its size, before it is read', { skip: process.getuid?.() === 0 && 'root reads everything' }, async (context) => {
  // Unreadable, so a read of it would fail otherwise than with the refusal.
  const oversized = async (path: string, bytes: number, extra: Record<string, string> = {}) => {
    const root = await archive(context, { [path]: '', ...extra });
    await truncate(join(root, path), bytes);
    await chmod(join(root, path), 0o000);
    await assert.rejects(planImport(root, OWNER, site()),
      (error) => error instanceof ArchiveInputError && error.code === 'content_invalid' && error.file === path, path);
  };
  await oversized('posts/en/a.md', 2 * 900_000 + 1);
  await oversized('posts/en/b.tome.json', 8 * 1024 * 1024 + 1, { 'posts/en/b.md': md({ title: 'B' }) });
});
