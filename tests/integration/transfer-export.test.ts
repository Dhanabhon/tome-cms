import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { mock } from 'node:test';

import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { sql, type Kysely, type Transaction } from 'kysely';
import pg from 'pg';

import type { Database } from '../../src/server/db/types';
import type { EditorDocument } from '../../src/types/cms';

const DATABASE_URL = 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test';

async function files(root: string, directory = ''): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...await files(root, path));
    else found.push(path);
  }
  return found.sort();
}

test('an export writes every post and page as Markdown and an exact copy, with the media they use', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, DATABASE_URL, 'use only the disposable Foundation database');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { createObjectKey } = await import('../../src/server/media/keys');
  const { getBuildInfo } = await import('../../src/server/update/current');
  const { mediaLink, readFrontMatter, readManifest } = await import('../../src/server/transfer/archive-format');
  const { exportSite } = await import('../../src/server/transfer/export');
  const { s3 } = await import('../../src/server/media/storage');
  context.after(closeDatabase);
  context.after(() => s3.destroy());
  await migrateToLatest();

  // The owner, two categories, and two real objects in the bucket.
  const owner = randomUUID();
  await db.insertInto('user').values({ id: owner, name: 'Owner', email: 'export@example.invalid', emailVerified: true, image: null, role: 'owner' }).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: owner, site_name: 'Export', default_locale: 'th', timezone: 'UTC', admin_path: '/admin', author_avatar_media_id: null,
  }).execute();
  await db.insertInto('categories').values([
    { owner_id: owner, name: 'Baking', slug: 'bread-and-cakes', description_th: 'ขนมปังและเค้ก', description_en: 'Bread and cakes.', is_default: false },
    { owner_id: owner, name: 'ขนม', slug: 'ขนม', is_default: false },
  ]).execute();
  const categories = await db.selectFrom('categories').select(['id', 'name']).execute();
  await db.insertInto('categories').values({ owner_id: owner, name: 'Unused', slug: 'unused', is_default: false }).execute();
  // Renamed (1.21): the manifest says what the default is called, so an import knows it.
  await db.insertInto('categories').values({ owner_id: owner, name: 'ไม่มีหมวดหมู่', slug: 'uncategorized', is_default: true }).execute();
  const baking = categories.find(({ name }) => name === 'Baking')!;

  const picture = { id: randomUUID(), key: createObjectKey(owner, 'image/png'), bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]) };
  const guide = { id: randomUUID(), key: createObjectKey(owner, 'application/pdf'), bytes: Buffer.from('%PDF-1.7\nคู่มือ\n%%EOF\n') };
  const poster = { id: randomUUID(), key: createObjectKey(owner, 'image/webp'), bytes: Buffer.from('RIFF....WEBPposter') };
  const unused = { id: randomUUID(), key: createObjectKey(owner, 'image/png') };
  const storage = new S3Client({
    credentials: { accessKeyId: 'tomecms_test', secretAccessKey: 'foundation-test-only' },
    endpoint: 'http://127.0.0.1:59000', forcePathStyle: true, region: 'us-east-1',
  });
  context.after(() => storage.destroy());
  for (const { key, bytes } of [picture, guide, poster]) {
    await storage.send(new PutObjectCommand({ Bucket: 'tomecms-test-media', Key: key, Body: bytes }));
  }
  const media = { owner_id: owner, folder_id: null, checksum_sha256: `${'A'.repeat(43)}=`, alt_text: null, state: 'ready' as const, delete_error_code: null };
  await db.insertInto('media_items').values([
    { ...media, id: picture.id, object_key: picture.key, original_name: 'loaf.png', mime_type: 'image/png', size_bytes: picture.bytes.length, width: 10, height: 10 },
    { ...media, id: guide.id, object_key: guide.key, original_name: 'คู่มือ.pdf', mime_type: 'application/pdf', size_bytes: guide.bytes.length, width: null, height: null },
    { ...media, id: poster.id, object_key: poster.key, original_name: 'poster.webp', mime_type: 'image/webp', size_bytes: poster.bytes.length, width: 4, height: 3 },
    { ...media, id: unused.id, object_key: unused.key, original_name: 'unused.png', mime_type: 'image/png', size_bytes: 3, width: 1, height: 1 },
  ]).execute();

  // A post in Thai and English sharing a group, a draft with a planned date, and a page.
  const thaiBody = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'สีแดง', marks: [{ type: 'textColor', attrs: { color: 'red' } }] }] },
      { type: 'image', attrs: { src: `/media/${picture.id}`, alt: 'ขนมปัง', mediaId: picture.id } },
      { type: 'attachment', attrs: { href: `/media/${guide.id}`, mediaId: guide.id, mimeType: 'application/pdf', name: 'คู่มือ.pdf', size: guide.bytes.length } },
      { type: 'paragraph', content: [{ type: 'text', text: 'อ่านคู่มือ', marks: [{ type: 'link', attrs: { href: `/media/${guide.id}`, mediaId: guide.id } }] }] },
      { type: 'image', attrs: { src: 'https://example.com/old.jpg', alt: 'old' } },
    ],
  } as EditorDocument;
  // A video's poster is a library file with no address of its own in the document.
  const video = { type: 'video', attrs: { provider: 'youtube', videoId: 'dQw4w9WgXcQ', start: null, title: 'Kneading', mediaId: poster.id } };
  const englishBody = {
    type: 'doc',
    content: [{ type: 'image', attrs: { src: `/media/${picture.id}`, alt: 'Bread', mediaId: picture.id } }, video],
  } as EditorDocument;
  const group = randomUUID();
  const draftGroup = randomUUID();
  const pageGroup = randomUUID();
  await db.insertInto('page_translation_groups').values({ id: pageGroup, owner_id: owner }).execute();
  const published = new Date('2026-09-01T08:00:00.000Z');
  const edition = { owner_id: owner, content_html: '', meta_title: null, meta_description: null, planned_at: null };
  // A group's categories are checked when its transaction commits.
  await db.transaction().execute(async (trx) => {
    await trx.insertInto('post_translation_groups').values([{ id: group, owner_id: owner }, { id: draftGroup, owner_id: owner }]).execute();
    await trx.insertInto('posts').values([
      { ...edition, translation_group_id: group, locale: 'th', title: 'ขนมปังยามค่ำ', slug: 'ขนมปัง-ยามค่ำ', content_json: thaiBody, status: 'published', published_at: published, cover_media_id: picture.id, show_cover: false, excerpt: 'ก้อนหนึ่ง', meta_title: 'ขนมปัง' },
      { ...edition, translation_group_id: group, locale: 'en', title: 'Bread at night', slug: 'bread-at-night', content_json: englishBody, status: 'published', published_at: published, cover_media_id: picture.id },
      { ...edition, translation_group_id: draftGroup, locale: 'en', title: 'Next loaf', slug: 'next-loaf', content_json: { type: 'doc', content: [] }, status: 'draft', published_at: null, planned_at: new Date('2026-12-24T00:00:00.000Z'), cover_media_id: null },
    ]).execute();
    await trx.insertInto('post_category_assignments').values([
      ...categories.map(({ id }) => ({ translation_group_id: group, category_id: id, owner_id: owner })),
      { translation_group_id: draftGroup, category_id: baking.id, owner_id: owner },
    ]).execute();
  });
  await db.insertInto('pages').values({
    ...edition, translation_group_id: pageGroup, locale: 'en', title: 'About', slug: 'about', content_json: { type: 'doc', content: [] }, status: 'published', published_at: published, meta_description: 'Who bakes.',
  }).execute();
  const rows = await db.selectFrom('posts').selectAll().execute();

  // A post another connection adds once the export has begun reading must not be in it.
  const other = new pg.Client({ connectionString: DATABASE_URL });
  await other.connect();
  context.after(() => other.end());
  const levels: string[] = [];
  const begin = db.transaction.bind(db);
  mock.method(db, 'transaction', () => {
    const builder = begin();
    return {
      setIsolationLevel(level: Parameters<typeof builder.setIsolationLevel>[0]) {
        levels.push(level);
        const isolated = builder.setIsolationLevel(level);
        return {
          execute: <T>(callback: (trx: Transaction<Database>) => Promise<T>) => isolated.execute(async (trx) => {
            await sql`select 1`.execute(trx);
            const late = randomUUID();
            await other.query('begin');
            await other.query('insert into post_translation_groups (id, owner_id) values ($1, $2)', [late, owner]);
            await other.query(
              `insert into posts (translation_group_id, locale, title, slug, content_json, content_html, status, owner_id)
               values ($1, 'en', 'Late', 'late', '{"type":"doc","content":[]}', '', 'draft', $2)`,
              [late, owner],
            );
            await other.query('insert into post_category_assignments (translation_group_id, category_id, owner_id) values ($1, $2, $3)', [late, baking.id, owner]);
            await other.query('commit');
            return callback(trx);
          }),
        };
      },
    };
  });

  const root = await mkdtemp(join(tmpdir(), 'tomecms-transfer-export-'));
  context.after(() => rm(root, { force: true, recursive: true }));
  const receipt = await exportSite(root);
  mock.restoreAll();

  assert.deepEqual(levels, ['repeatable read'], 'every row is read in one REPEATABLE READ transaction');
  assert.ok(await (db as Kysely<Database>).selectFrom('posts').select('id').where('slug', '=', 'late').executeTakeFirst(), 'the late post was written');
  assert.deepEqual(receipt, { counts: { posts: 3, pages: 1, media: 3 }, formattingNotShown: 1 });

  assert.deepEqual(await files(root), [
    'manifest.json',
    `media/${guide.key}`,
    `media/${picture.key}`,
    `media/${poster.key}`,
    'pages/en/about.md',
    'pages/en/about.tome.json',
    'posts/en/bread-at-night.md',
    'posts/en/bread-at-night.tome.json',
    'posts/en/next-loaf.md',
    'posts/en/next-loaf.tome.json',
    'posts/th/ขนมปัง-ยามค่ำ.md',
    'posts/th/ขนมปัง-ยามค่ำ.tome.json',
  ].sort(), 'no late post, and no File Manager item nothing uses');
  for (const path of await files(root)) assert.equal((await stat(join(root, path))).mode & 0o777, 0o600, path);
  assert.equal((await stat(join(root, 'posts', 'th'))).mode & 0o777, 0o700);

  const manifest = readManifest(await readFile(join(root, 'manifest.json'), 'utf8'));
  assert.equal(new Date(manifest.createdAt).toISOString(), manifest.createdAt);
  const listed = (item: { id: string; key: string; bytes: Buffer }, name: string, type: string) =>
    ({ path: `media/${item.key}`, name, type, sha256: `${'A'.repeat(43)}=`, size: item.bytes.length });
  assert.deepEqual({ ...manifest, createdAt: undefined }, {
    format: 'tomecms-markdown', version: 1, createdAt: undefined, applicationVersion: getBuildInfo().version,
    publicUrl: 'http://localhost:4321', counts: { posts: 3, pages: 1, media: 3 },
    media: {
      [picture.id]: listed(picture, 'loaf.png', 'image/png'),
      [guide.id]: listed(guide, 'คู่มือ.pdf', 'application/pdf'),
      [poster.id]: listed(poster, 'poster.webp', 'image/webp'),
    },
    // Front matter names a category; its address and descriptions travel here, once each.
    categories: [
      { name: 'Baking', slug: 'bread-and-cakes', descriptionTh: 'ขนมปังและเค้ก', descriptionEn: 'Bread and cakes.' },
      { name: 'ขนม', slug: 'ขนม', descriptionTh: '', descriptionEn: '' },
    ],
    defaultCategory: 'ไม่มีหมวดหมู่',
  }, 'every file by its id, the video poster too, and nothing unused');

  const read = async (path: string) => readFrontMatter(await readFile(join(root, path), 'utf8'), path);
  const thai = await read('posts/th/ขนมปัง-ยามค่ำ.md');
  const thaiRow = rows.find((row) => row.locale === 'th')!;
  assert.deepEqual(thai.frontMatter, {
    title: 'ขนมปังยามค่ำ', slug: 'ขนมปัง-ยามค่ำ', language: 'th', status: 'published', published: published.toISOString(),
    updated: thaiRow.updated_at.toISOString(), categories: ['Baking', 'ขนม'], excerpt: 'ก้อนหนึ่ง', cover: mediaLink(picture.key),
    show_cover: false, meta_title: 'ขนมปัง', translation: group,
  });
  assert.match(thai.body, new RegExp(`!\\[ขนมปัง\\]\\(\\.\\./\\.\\./media/${picture.key}\\)`));
  assert.ok(thai.body.includes(`[คู่มือ.pdf](../../media/${guide.key})`), 'the attachment is a link to its file');
  const english = await read('posts/en/bread-at-night.md');
  assert.equal(english.frontMatter.translation, thai.frontMatter.translation, 'the pair shares one translation');
  assert.equal(english.frontMatter.show_cover, true);
  const draft = await read('posts/en/next-loaf.md');
  assert.equal(draft.frontMatter.status, 'draft');
  assert.equal(draft.frontMatter.published, undefined);
  assert.equal(draft.frontMatter.planned, '2026-12-24T00:00:00.000Z');
  assert.deepEqual(draft.frontMatter.categories, ['Baking']);
  assert.equal(draft.frontMatter.cover, undefined);
  const page = await read('pages/en/about.md');
  assert.equal(page.frontMatter.meta_description, 'Who bakes.');
  assert.equal(page.frontMatter.categories, undefined, 'a page has no categories');
  assert.equal(page.frontMatter.show_cover, undefined, 'and no cover');

  const exact = JSON.parse(await readFile(join(root, 'posts/th/ขนมปัง-ยามค่ำ.tome.json'), 'utf8'));
  assert.deepEqual(exact, {
    type: 'doc',
    content: [
      thaiBody.content![0],
      { type: 'image', attrs: { src: mediaLink(picture.key), alt: 'ขนมปัง', mediaId: picture.id } },
      { type: 'attachment', attrs: { href: mediaLink(guide.key), mediaId: guide.id, mimeType: 'application/pdf', name: 'คู่มือ.pdf', size: guide.bytes.length } },
      { type: 'paragraph', content: [{ type: 'text', text: 'อ่านคู่มือ', marks: [{ type: 'link', attrs: { href: mediaLink(guide.key), mediaId: guide.id } }] }] },
      thaiBody.content![4],
    ],
  });
  const stored = await db.selectFrom('posts').select('content_json').where('id', '=', thaiRow.id).executeTakeFirstOrThrow();
  assert.deepEqual(stored.content_json, thaiBody, 'the database keeps its own addresses');

  assert.deepEqual(await readFile(join(root, 'media', ...picture.key.split('/'))), picture.bytes);
  assert.deepEqual(await readFile(join(root, 'media', ...guide.key.split('/'))), guide.bytes);
  assert.deepEqual(await readFile(join(root, ...manifest.media[poster.id]!.path.split('/'))), poster.bytes, 'the poster, found by its id');
  const englishExact = JSON.parse(await readFile(join(root, 'posts/en/bread-at-night.tome.json'), 'utf8'));
  assert.deepEqual(englishExact.content[1], video, 'a video keeps its poster id exactly');

  // An object gone from the bucket stops the export, naming the file it is.
  await storage.send(new DeleteObjectCommand({ Bucket: 'tomecms-test-media', Key: guide.key }));
  const again = await mkdtemp(join(tmpdir(), 'tomecms-transfer-export-'));
  context.after(() => rm(again, { force: true, recursive: true }));
  await assert.rejects(exportSite(again), (error) =>
    (error as { code?: unknown }).code === 'media_missing' && (error as { mediaId?: unknown }).mediaId === guide.id);
  await assert.rejects(stat(join(again, 'manifest.json')), 'no manifest, so the directory is not a whole export');
});
