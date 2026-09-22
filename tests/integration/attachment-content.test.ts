import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import type { EditorDocument } from '../../src/types/cms';

test('a card is written from the library, keeps its file from deletion, and is written again on publish', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { createPage, updatePageStatus } = await import('../../src/server/content/pages');
  const { createPost, updatePost, updatePostStatus } = await import('../../src/server/content/posts');
  const { HttpError } = await import('../../src/server/http/errors');
  const { deleteMedia } = await import('../../src/server/media/service');
  context.after(closeDatabase);

  await migrateToLatest();
  const ownerId = randomUUID();
  await db.insertInto('user').values({
    id: ownerId, name: 'Owner', email: 'cards@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: ownerId, site_name: 'Cards', default_locale: 'en', timezone: 'UTC', admin_path: '/admin',
  }).execute();
  const category = await db.insertInto('categories').values({ owner_id: ownerId, name: 'Uncategorized', is_default: true })
    .returning('id').executeTakeFirstOrThrow();
  // What a finished upload leaves in the library: a PDF, and an image.
  const stored = {
    owner_id: ownerId, folder_id: null, checksum_sha256: `${'A'.repeat(43)}=`, alt_text: null, state: 'ready' as const, delete_error_code: null,
  };
  const pdf = await db.insertInto('media_items').values({
    ...stored, object_key: `owners/${ownerId}/2026/09/${randomUUID()}.pdf`, original_name: 'คู่มือการสมัคร.pdf',
    mime_type: 'application/pdf', size_bytes: 1_258_291, width: null, height: null,
  }).returning('id').executeTakeFirstOrThrow();
  const png = await db.insertInto('media_items').values({
    ...stored, object_key: `owners/${ownerId}/2026/09/${randomUUID()}.png`, original_name: 'photo.png',
    mime_type: 'image/png', size_bytes: 100, width: 2, height: 1,
  }).returning('id').executeTakeFirstOrThrow();

  const card = (mediaId: string): EditorDocument => ({ type: 'doc', content: [{
    type: 'attachment', attrs: { href: 'https://elsewhere.example/', mediaId, mimeType: 'application/zip', name: 'lie.zip', size: 1 },
  }] });
  const input = (contentJson: EditorDocument) => ({
    excerpt: '', categoryIds: [category.id], coverMediaId: null, contentJson, metaDescription: null, metaTitle: null,
    slug: `post-${randomUUID()}`, status: 'draft' as const, title: 'With a file',
  });
  const badRequest = (error: unknown) => error instanceof HttpError && error.status === 400;

  const post = await createPost(ownerId, input(card(pdf.id)));
  assert.deepEqual(post.content_json.content?.[0]?.attrs,
    { href: `/media/${pdf.id}`, mediaId: pdf.id, mimeType: 'application/pdf', name: 'คู่มือการสมัคร.pdf', size: 1_258_291 });
  assert.match(post.content_html, /<span class="file-card__meta">PDF · 1\.2 MB<\/span>/);
  assert.doesNotMatch(post.content_html, /elsewhere|lie\.zip/);

  // An image is not a file to attach, and neither is one the library does not have -- deleted,
  // say, while a draft still held its card. Either is named as such, not as invalid content.
  const noSuchFile = (error: unknown) => badRequest(error) && (error as Error).message === 'Choose a file from this site.';
  await assert.rejects(createPost(ownerId, input(card(png.id))), noSuchFile);
  await assert.rejects(createPost(ownerId, input(card(randomUUID()))), noSuchFile);

  // Publishing writes the card again, through the transaction it runs in: the pool holds one connection.
  const published = await updatePostStatus(ownerId, { id: post.id, status: 'published', updatedAt: post.updated_at });
  assert.equal(published.status, 'published');
  assert.match(published.content_html, /class="file-card"/);
  // An edit that keeps it published writes the card again, from the library.
  const edited = await updatePost(ownerId, { ...input(card(pdf.id)), id: post.id, status: 'published', title: 'With a file, edited', updatedAt: published.updated_at });
  assert.match(edited.content_html, /<span class="file-card__meta">PDF · 1\.2 MB<\/span>/);

  // A page takes a card as well, and the file cannot be deleted while either uses it.
  const page = await createPage(ownerId, {
    excerpt: '', contentJson: card(pdf.id), metaDescription: null, metaTitle: null,
    slug: `page-${randomUUID()}`, status: 'draft', title: 'A page with a file',
  });
  const publishedPage = await updatePageStatus(ownerId, { id: page.id, status: 'published', updatedAt: page.updated_at });
  assert.match(publishedPage.content_html, /<span class="file-card__name">คู่มือการสมัคร\.pdf<\/span>/);
  await assert.rejects(deleteMedia(ownerId, pdf.id), (error: unknown) => {
    const counts = (error as { details?: { references?: { counts?: Record<string, number> } } }).details?.references?.counts;
    return error instanceof HttpError && error.status === 409 && counts?.postContent === 1 && counts.pageContent === 1;
  });
});
