import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import type { EditorDocument } from '../../src/types/cms';

test('an article with a video lists its poster, and the library keeps the poster while it is used', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { createPost, updatePostStatus } = await import('../../src/server/content/posts');
  const { listPublishedPosts } = await import('../../src/server/content/published');
  const { HttpError } = await import('../../src/server/http/errors');
  const { deleteMedia } = await import('../../src/server/media/service');
  context.after(closeDatabase);

  await migrateToLatest();
  const ownerId = randomUUID();
  await db.insertInto('user').values({ id: ownerId, name: 'Owner', email: 'video@example.invalid', emailVerified: true, image: null, role: 'owner' }).execute();
  await db.insertInto('site_settings').values({ id: true, owner_id: ownerId, site_name: 'Videos', default_locale: 'en', timezone: 'UTC', admin_path: '/admin' }).execute();
  const category = await db.insertInto('categories').values({ owner_id: ownerId, name: 'Uncategorized', is_default: true }).returning('id').executeTakeFirstOrThrow();
  const poster = await db.insertInto('media_items').values({
    owner_id: ownerId, folder_id: null, checksum_sha256: `${'A'.repeat(43)}=`, alt_text: null, state: 'ready', delete_error_code: null,
    object_key: `owners/${ownerId}/2026/09/${randomUUID()}.jpg`, original_name: 'A clip', mime_type: 'image/jpeg', size_bytes: 100, width: 480, height: 360,
  }).returning('id').executeTakeFirstOrThrow();
  const withVideo = (mediaId: string): EditorDocument => ({
    type: 'doc',
    content: [{ type: 'video', attrs: { mediaId, provider: 'youtube', start: null, title: 'A clip', videoId: 'dQw4w9WgXcQ' } }],
  });
  const input = (contentJson: EditorDocument) => ({
    excerpt: '', categoryIds: [category.id], coverMediaId: null, contentJson, metaDescription: null, metaTitle: null,
    slug: `post-${randomUUID()}`, status: 'draft' as const, title: 'With a video',
  });

  await assert.rejects(createPost(ownerId, input(withVideo(randomUUID()))), (error: unknown) => error instanceof HttpError && error.status === 400);

  const post = await createPost(ownerId, input(withVideo(poster.id)));
  await updatePostStatus(ownerId, { id: post.id, status: 'published', updatedAt: post.updated_at });
  const published = await listPublishedPosts({ locale: 'en', limit: 5 });
  const item = published.items.find(({ id }) => id === post.id);
  assert.deepEqual(item?.media.map(({ id }) => id), [poster.id]);
  assert.match(item?.content_html ?? '', /<figure class="tome-video">/);

  await assert.rejects(deleteMedia(ownerId, poster.id), (error: unknown) => {
    const counts = (error as { details?: { references?: { counts?: Record<string, number> } } }).details?.references?.counts;
    return error instanceof HttpError && error.status === 409 && counts?.postContent === 1;
  });
});
