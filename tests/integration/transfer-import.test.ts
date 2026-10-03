import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';

import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { sql } from 'kysely';
import sharp from 'sharp';

import type { EditorDocument } from '../../src/types/cms';

const DATABASE_URL = 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test';
const OWNER = randomUUID();

type Modules = {
  db: typeof import('../../src/server/db/client').db;
  s3: typeof import('../../src/server/media/storage').s3;
  applyImport: typeof import('../../src/server/transfer/import-apply').applyImport;
};
let m: Modules;
const roots: string[] = [];

async function tempDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'tomecms-transfer-import-'));
  roots.push(root);
  return root;
}

async function writeTree(root: string, files: Record<string, string | Buffer>): Promise<void> {
  for (const [path, data] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), data);
  }
}

/** A site with only its owner, its settings and its default category: what an install leaves. */
async function seedSite(): Promise<void> {
  await m.db.insertInto('user').values({ id: OWNER, name: 'Owner', email: 'import@example.invalid', emailVerified: true, image: null, role: 'owner' }).execute();
  await m.db.insertInto('site_settings').values({
    id: true, owner_id: OWNER, site_name: 'Import', default_locale: 'th', timezone: 'UTC', admin_path: '/admin', author_avatar_media_id: null,
  }).execute();
  await m.db.insertInto('categories').values({ owner_id: OWNER, name: 'Uncategorized', is_default: true }).execute();
}

async function objectKeys(): Promise<string[]> {
  const listed = await m.s3.send(new ListObjectsV2Command({ Bucket: 'tomecms-test-media', Prefix: `owners/${OWNER}/` }));
  return (listed.Contents ?? []).map(({ Key }) => Key!).sort();
}

async function objectBytes(key: string): Promise<Buffer> {
  const object = await m.s3.send(new GetObjectCommand({ Bucket: 'tomecms-test-media', Key: key }));
  return Buffer.from(await object.Body!.transformToByteArray());
}

async function rowCounts() {
  const count = async (table: 'posts' | 'pages' | 'media_items' | 'categories' | 'post_translation_groups' | 'page_translation_groups' | 'post_category_assignments') =>
    Number((await m.db.selectFrom(table).select(({ fn }) => fn.countAll<string>().as('n')).executeTakeFirstOrThrow()).n);
  return {
    posts: await count('posts'), pages: await count('pages'), media: await count('media_items'), categories: await count('categories'),
    postGroups: await count('post_translation_groups'), pageGroups: await count('page_translation_groups'),
    assignments: await count('post_category_assignments'),
  };
}

const refusal = (code: string, file: string) => (error: unknown) =>
  (error as { code?: unknown }).code === code && (error as { file?: unknown }).file === file;

before(async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, DATABASE_URL, 'use only the disposable Foundation database');
  const { db } = await import('../../src/server/db/client');
  const { s3 } = await import('../../src/server/media/storage');
  const { applyImport } = await import('../../src/server/transfer/import-apply');
  m = { db, s3, applyImport };
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  await migrateToLatest();
  await seedSite();
});

after(async () => {
  const { closeDatabase } = await import('../../src/server/db/client');
  for (const root of roots) await rm(root, { force: true, recursive: true });
  m.s3.destroy();
  await closeDatabase();
});

let exported = '';

test('an export imported into an empty site comes back whole: content, status, dates, categories, groups, covers and media', async () => {
  const { createMediaFromBytes } = await import('../../src/server/media/service');
  const { createPost } = await import('../../src/server/content/posts');
  const { createPage } = await import('../../src/server/content/pages');
  const { exportSite } = await import('../../src/server/transfer/export');
  const { migrateToLatest } = await import('../../src/server/db/migrator');

  const pictureBytes = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#2a9d8f' } }).png().toBuffer();
  const posterBytes = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#336699' } }).webp().toBuffer();
  const guideBytes = Buffer.from('%PDF-1.7\nคู่มือ\n%%EOF\n');
  const picture = await createMediaFromBytes(OWNER, pictureBytes, 'loaf.png');
  const poster = await createMediaFromBytes(OWNER, posterBytes, 'poster.webp');
  const guide = await createMediaFromBytes(OWNER, guideBytes, 'คู่มือ.pdf');
  const [baking, khanom] = await m.db.insertInto('categories').values([
    { owner_id: OWNER, name: 'Baking', is_default: false },
    { owner_id: OWNER, name: 'ขนม', is_default: false },
  ]).returning('id').execute();

  const thaiBody = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'ขนมปัง', marks: [{ type: 'bold' }] }] },
      { type: 'image', attrs: { src: `/media/${picture.id}`, alt: 'ขนมปัง', mediaId: picture.id } },
      { type: 'attachment', attrs: { href: `/media/${guide.id}`, mediaId: guide.id, mimeType: 'application/pdf', name: 'คู่มือ.pdf', size: guideBytes.length } },
      { type: 'paragraph', content: [{ type: 'text', text: 'อ่านคู่มือ', marks: [{ type: 'link', attrs: { href: `/media/${guide.id}`, mediaId: guide.id } }] }] },
      { type: 'image', attrs: { src: 'https://example.com/old.jpg', alt: 'old' } },
    ],
  } as EditorDocument;
  const englishBody = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Bread at night.' }] },
      { type: 'image', attrs: { src: `/media/${picture.id}`, alt: 'Bread', mediaId: picture.id } },
      { type: 'video', attrs: { provider: 'youtube', videoId: 'dQw4w9WgXcQ', start: null, title: 'Kneading', mediaId: poster.id } },
    ],
  } as EditorDocument;
  const common = { metaTitle: null, metaDescription: null, excerpt: '' };
  const thai = await createPost(OWNER, {
    ...common, title: 'ขนมปังยามค่ำ', slug: 'ขนมปัง-ยาม-ค่ำ', contentJson: thaiBody, status: 'published', publishedAt: '2026-09-01T08:00:00.000Z',
    categoryIds: [baking!.id, khanom!.id], coverMediaId: picture.id, showCover: false, excerpt: 'ก้อนหนึ่ง', metaTitle: 'ขนมปัง',
  });
  await createPost(OWNER, {
    ...common, title: 'Bread at night', slug: 'bread-at-night', contentJson: englishBody, status: 'published', publishedAt: '2026-09-02T08:00:00.000Z',
    categoryIds: [baking!.id, khanom!.id], coverMediaId: picture.id, locale: 'en', sourcePostId: thai.id,
  });
  await createPost(OWNER, {
    ...common, title: 'Next loaf', slug: 'next-loaf', contentJson: { type: 'doc', content: [] }, status: 'draft', publishedAt: '2026-12-24T00:00:00.000Z',
    categoryIds: [baking!.id], coverMediaId: null, locale: 'en',
  });
  await createPage(OWNER, {
    ...common, title: 'About', slug: 'about', status: 'published', publishedAt: '2026-08-01T00:00:00.000Z', metaDescription: 'Who bakes.',
    contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'We bake.' }] }] },
  });

  const editions = async () => {
    const posts = await m.db.selectFrom('posts')
      .select(['translation_group_id', 'locale', 'title', 'slug', 'content_json', 'content_html', 'status', 'published_at', 'planned_at', 'show_cover', 'cover_media_id', 'excerpt', 'meta_title', 'meta_description'])
      .orderBy('slug').execute();
    const pages = await m.db.selectFrom('pages')
      .select(['translation_group_id', 'locale', 'title', 'slug', 'content_json', 'content_html', 'status', 'published_at', 'planned_at', 'excerpt', 'meta_title', 'meta_description'])
      .orderBy('slug').execute();
    const assigned = await m.db.selectFrom('post_category_assignments').innerJoin('categories', 'categories.id', 'post_category_assignments.category_id')
      .select(['translation_group_id', 'name']).orderBy('name').execute();
    const media = await m.db.selectFrom('media_items').select(['id', 'object_key', 'original_name', 'mime_type', 'checksum_sha256', 'size_bytes', 'width', 'height']).execute();
    return { posts, pages, assigned, media };
  };
  const before = await editions();

  exported = await tempDirectory();
  await exportSite(exported);

  // A fresh site: the schema emptied and migrated again, with only the owner and the settings.
  await sql`drop schema public cascade; create schema public;`.execute(m.db);
  await migrateToLatest();
  await seedSite();

  const result = await m.applyImport(exported, OWNER);
  assert.deepEqual(result, {
    create: [
      { kind: 'page', locale: 'th', slug: 'about', path: 'pages/th/about.md', source: 'tome.json' },
      { kind: 'post', locale: 'en', slug: 'bread-at-night', path: 'posts/en/bread-at-night.md', source: 'tome.json' },
      { kind: 'post', locale: 'en', slug: 'next-loaf', path: 'posts/en/next-loaf.md', source: 'tome.json' },
      { kind: 'post', locale: 'th', slug: 'ขนมปัง-ยาม-ค่ำ', path: 'posts/th/ขนมปัง-ยาม-ค่ำ.md', source: 'tome.json' },
    ],
    skip: [],
    media: { upload: 3, reuse: 0 },
    categoriesToCreate: ['Baking', 'ขนม'],
    groupsSplit: [],
    missingMedia: 0,
  });

  const now = await editions();
  // Each file is a new item with the same bytes; the old id stands for the new one everywhere.
  const newId = new Map(before.media.map((old) => [old.id, now.media.find((row) => row.checksum_sha256 === old.checksum_sha256)!.id]));
  assert.equal(new Set(newId.values()).size, 3);
  const renamed = <T>(value: T): T => {
    let text = JSON.stringify(value);
    for (const [old, fresh] of newId) text = text.replaceAll(old, fresh);
    return JSON.parse(text) as T;
  };
  for (const row of now.media) {
    const old = before.media.find(({ id }) => newId.get(id) === row.id)!;
    assert.deepEqual({ ...row, id: undefined, object_key: undefined }, { ...old, id: undefined, object_key: undefined });
    assert.deepEqual(await objectBytes(row.object_key), await objectBytes(old.object_key), 'the object is byte-equal');
  }

  const groupOf = (rows: { translation_group_id: string; slug: string }[]) => (slug: string) => rows.find((row) => row.slug === slug)!.translation_group_id;
  const strip = <T extends { translation_group_id: string; published_at: Date | null; planned_at: Date | null }>(rows: T[]) =>
    rows.map(({ translation_group_id: _group, ...row }) => ({ ...row, published_at: row.published_at?.toISOString() ?? null, planned_at: row.planned_at?.toISOString() ?? null }));
  assert.deepEqual(strip(now.posts), renamed(strip(before.posts)), 'every post, its document and its dates');
  assert.deepEqual(strip(now.pages), strip(before.pages), 'the page');
  const beforeGroup = groupOf(before.posts);
  const nowGroup = groupOf(now.posts);
  assert.equal(nowGroup('bread-at-night'), nowGroup('ขนมปัง-ยาม-ค่ำ'), 'the pair is one group again');
  assert.notEqual(nowGroup('next-loaf'), nowGroup('bread-at-night'));
  const names = (assigned: { translation_group_id: string; name: string }[], group: string) =>
    assigned.filter((row) => row.translation_group_id === group).map(({ name }) => name);
  for (const slug of ['ขนมปัง-ยาม-ค่ำ', 'next-loaf']) {
    assert.deepEqual(names(now.assigned, nowGroup(slug)), names(before.assigned, beforeGroup(slug)), `${slug}'s categories`);
  }
  const englishNow = now.posts.find((row) => row.slug === 'bread-at-night')!;
  assert.equal(englishNow.cover_media_id, newId.get(picture.id), 'the cover');
  assert.equal((englishNow.content_json.content![2]!.attrs as { mediaId: string }).mediaId, newId.get(poster.id), "the video's poster");
});

test('the same archive imported again skips everything and writes nothing', async () => {
  const counts = await rowCounts();
  const keys = await objectKeys();
  const result = await m.applyImport(exported, OWNER);
  assert.deepEqual(result.create, []);
  assert.deepEqual(result.skip.map(({ path }) => path), [
    'pages/th/about.md', 'posts/en/bread-at-night.md', 'posts/en/next-loaf.md', 'posts/th/ขนมปัง-ยาม-ค่ำ.md',
  ]);
  assert.ok(result.skip.every(({ reason }) => reason === 'slug_taken'));
  assert.deepEqual(result.media, { upload: 0, reuse: 0 });
  assert.deepEqual(await rowCounts(), counts);
  assert.deepEqual(await objectKeys(), keys);
});

test('hand-written Markdown with no exact copy: no status is a draft, and a published one keeps its date', async () => {
  const root = await tempDirectory();
  const photo = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#e76f51' } }).png().toBuffer();
  await writeTree(root, {
    'posts/en/notes.md': '---\ntitle: Notes\n---\n\nJust notes.\n',
    'posts/en/out-now.md': '---\r\ntitle: Out now\r\nstatus: published\r\npublished: 2026-01-02T00:00:00Z\r\ncategories: [Baking, Rye]\r\n---\r\n\r\nIt is out.\r\n\r\n![The loaf](../../media/photo.png)\r\n\r\n![Gone](../../media/gone.png)\r\n',
    'media/photo.png': photo,
  });
  const result = await m.applyImport(root, OWNER);
  assert.deepEqual(result.create.map(({ slug, source }) => [slug, source]), [['notes', 'md'], ['out-now', 'md']]);
  assert.deepEqual(result.categoriesToCreate, ['Rye']);
  assert.equal(result.missingMedia, 1, 'the picture with no file');

  const notes = await m.db.selectFrom('posts').selectAll().where('slug', '=', 'notes').executeTakeFirstOrThrow();
  assert.equal(notes.status, 'draft');
  assert.equal(notes.published_at, null);
  assert.equal(notes.locale, 'en', 'its folder names its language');
  const out = await m.db.selectFrom('posts').selectAll().where('slug', '=', 'out-now').executeTakeFirstOrThrow();
  assert.equal(out.status, 'published');
  assert.equal(out.published_at?.toISOString(), '2026-01-02T00:00:00.000Z');
  const uploaded = await m.db.selectFrom('media_items').select('id').where('original_name', '=', 'photo.png').executeTakeFirstOrThrow();
  assert.deepEqual(out.content_json.content!.map((node) => node.type), ['paragraph', 'image', 'paragraph']);
  assert.deepEqual(out.content_json.content![1]!.attrs, { src: `/media/${uploaded.id}`, alt: 'The loaf', title: null, mediaId: uploaded.id });
  assert.deepEqual(out.content_json.content![2], { type: 'paragraph', content: [{ type: 'text', text: '[Missing image: gone.png]' }] });
});

test('an import that fails part-way leaves no item, no media row and no uploaded object behind', async () => {
  const root = await tempDirectory();
  const picture = (color: string) => sharp({ create: { width: 2, height: 2, channels: 3, background: color } }).png().toBuffer();
  const md = (title: string, slug: string, src: string) =>
    `---\ntitle: ${title}\nslug: ${slug}\nstatus: published\n---\n\nWords.\n\n![${title}](../../media/${src})\n`;
  await writeTree(root, {
    'posts/en/a-first.md': md('First', 'first', 'one.png'),
    'posts/en/b-second.md': md('Second', 'second', 'two.png'),
    // Published with nothing in it: refused when it is written, after the pictures went up.
    'posts/en/c-third.md': '---\ntitle: Third\nslug: third\nstatus: published\n---\n',
    'media/one.png': await picture('#111111'),
    'media/two.png': await picture('#222222'),
  });
  const counts = await rowCounts();
  const keys = await objectKeys();
  await assert.rejects(m.applyImport(root, OWNER), refusal('content_invalid', 'posts/en/c-third.md'));
  assert.deepEqual(await rowCounts(), counts, 'no post, and no media row from this import');
  assert.equal(await m.db.selectFrom('posts').select('id').where('slug', 'in', ['first', 'second']).executeTakeFirst(), undefined);
  assert.deepEqual(await objectKeys(), keys, 'the uploaded objects are deleted from the bucket');
});

test('a picture over the limit refuses the whole input before anything is written', async () => {
  const root = await tempDirectory();
  const huge = Buffer.alloc(9 * 1024 * 1024);
  (await sharp({ create: { width: 1, height: 1, channels: 3, background: '#000000' } }).png().toBuffer()).copy(huge);
  await writeTree(root, {
    'posts/en/big.md': '---\ntitle: Big\n---\n\n![big](../../media/big.png)\n',
    'media/big.png': huge,
  });
  const counts = await rowCounts();
  const keys = await objectKeys();
  await assert.rejects(m.applyImport(root, OWNER), refusal('media_too_large', 'media/big.png'));
  assert.deepEqual(await rowCounts(), counts);
  assert.deepEqual(await objectKeys(), keys);
});

test('an English page is created in English, and an empty published document is refused by its file', async () => {
  const root = await tempDirectory();
  await writeTree(root, { 'pages/en/contact.md': '---\ntitle: Contact\nstatus: published\n---\n\nWrite to us.\n' });
  const result = await m.applyImport(root, OWNER);
  assert.deepEqual(result.create, [{ kind: 'page', locale: 'en', slug: 'contact', path: 'pages/en/contact.md', source: 'md' }]);
  const page = await m.db.selectFrom('pages').select(['locale', 'status']).where('slug', '=', 'contact').executeTakeFirstOrThrow();
  assert.deepEqual(page, { locale: 'en', status: 'published' });

  const empty = await tempDirectory();
  await writeTree(empty, { 'posts/en/empty.md': '---\ntitle: Empty\nstatus: published\n---\n' });
  const counts = await rowCounts();
  await assert.rejects(m.applyImport(empty, OWNER), refusal('content_invalid', 'posts/en/empty.md'));
  assert.deepEqual(await rowCounts(), counts);
});

test('a .pdf that is not a PDF is refused when it is uploaded, and the files uploaded before it are taken back', async () => {
  const root = await tempDirectory();
  await writeTree(root, {
    'posts/en/guide.md': '---\ntitle: Guide\n---\n\n![a](../../media/a.png)\n\n[The guide](../../media/guide.pdf)\n\n![b](../../media/guide.pdf)\n',
    'media/a.png': await sharp({ create: { width: 2, height: 2, channels: 3, background: '#444444' } }).png().toBuffer(),
    'media/guide.pdf': 'not a pdf at all',
  });
  const counts = await rowCounts();
  const keys = await objectKeys();
  await assert.rejects(m.applyImport(root, OWNER), refusal('media_type_unsupported', 'media/guide.pdf'));
  assert.deepEqual(await rowCounts(), counts);
  assert.deepEqual(await objectKeys(), keys);
});

test('a clean-up delete that fails names the object left behind, and the others are still removed', async (context) => {
  const root = await tempDirectory();
  const picture = (color: string) => sharp({ create: { width: 2, height: 2, channels: 3, background: color } }).png().toBuffer();
  await writeTree(root, {
    'posts/en/a.md': '---\ntitle: A\nslug: a-cleanup\n---\n\n![a](../../media/one.png)\n\n![b](../../media/two.png)\n',
    'posts/en/b.md': '---\ntitle: B\nslug: b-cleanup\nstatus: published\n---\n',
    'media/one.png': await picture('#555555'),
    'media/two.png': await picture('#666666'),
  });
  const keys = await objectKeys();
  const send = m.s3.send.bind(m.s3);
  let refused: string | undefined;
  context.mock.method(m.s3, 'send', (command: unknown) => {
    if (command instanceof DeleteObjectCommand && refused === undefined) {
      refused = command.input.Key!;
      return Promise.reject(new Error('injected'));
    }
    return send(command as Parameters<typeof send>[0]);
  });
  const logged = context.mock.method(console, 'error', () => undefined);
  await assert.rejects(m.applyImport(root, OWNER), refusal('content_invalid', 'posts/en/b.md'));
  context.mock.restoreAll();
  assert.ok(refused, 'a delete was refused');
  assert.deepEqual(logged.mock.calls.map((call) => String(call.arguments[0])),
    [`The uploaded files could not all be removed: These objects are left in the bucket: ${refused}`]);
  assert.deepEqual(await objectKeys(), [...keys, refused].sort(), 'only the one that failed is left');
  await send(new DeleteObjectCommand({ Bucket: 'tomecms-test-media', Key: refused }));
});


test('a valid slug in the archive is kept byte for byte, even one contentSlug would split, and a second plan skips it', async () => {
  const { contentSlug } = await import('../../src/lib/slug');
  const { planImport } = await import('../../src/server/transfer/import-plan');
  const post = 'สวัสดี-ชาวโลก';
  const page = 'เกี่ยวกับ';
  assert.notEqual(contentSlug(post), post, 'this ICU splits it further');
  assert.notEqual(contentSlug(page), page, 'and this one');
  const root = await tempDirectory();
  await writeTree(root, {
    'posts/th/hello.md': `---\ntitle: สวัสดี\nslug: ${post}\n---\n\nคำ\n`,
    'pages/th/about.md': `---\ntitle: เกี่ยวกับ\nslug: ${page}\n---\n\nคำ\n`,
  });
  const planned = await planImport(root, OWNER);
  const result = await m.applyImport(root, OWNER);
  assert.deepEqual(planned.create.map(({ slug }) => slug), [page, post]);
  assert.deepEqual(result.create, planned.create, 'the plan and the write agree');
  const stored = await m.db.selectFrom('posts').select('slug').where('slug', '=', post).executeTakeFirst();
  assert.equal(Buffer.from(stored?.slug ?? '').toString('hex'), Buffer.from(post).toString('hex'), 'the post keeps its address');
  assert.ok(await m.db.selectFrom('pages').select('slug').where('slug', '=', page).executeTakeFirst(), 'the page keeps its address');

  const again = await planImport(root, OWNER);
  assert.deepEqual(again.create, []);
  assert.deepEqual(again.skip.map(({ path }) => path), ['pages/th/about.md', 'posts/th/hello.md']);
});

test('a slug that is not one is made one, and the plan names the slug the write stores', async () => {
  const { planImport } = await import('../../src/server/transfer/import-plan');
  const root = await tempDirectory();
  await writeTree(root, { 'posts/en/odd.md': '---\ntitle: Odd\nslug: Rye & Spelt Loaves!\n---\n\nWords.\n' });
  const planned = await planImport(root, OWNER);
  assert.deepEqual(planned.create.map(({ slug }) => slug), ['rye-spelt-loaves']);
  const result = await m.applyImport(root, OWNER);
  assert.deepEqual(result.create, planned.create);
  assert.ok(await m.db.selectFrom('posts').select('id').where('slug', '=', 'rye-spelt-loaves').executeTakeFirst());
  assert.deepEqual((await planImport(root, OWNER)).create, [], 'a second plan skips it');
});
