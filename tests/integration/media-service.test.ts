import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';

import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

test('media uploads stay hidden until verified and invalid bytes are discarded', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { createPage } = await import('../../src/server/content/pages');
  const { createPost } = await import('../../src/server/content/posts');
  const { HttpError } = await import('../../src/server/http/errors');
  const {
    createFolder,
    deleteFolder,
    deleteMedia,
    finalizeUpload,
    listFolders,
    listMedia,
    mediaListInputSchema,
    renameFolder,
    reserveUpload,
    reserveUploadSchema,
    updateMedia,
  } = await import('../../src/server/media/service');
  const { s3 } = await import('../../src/server/media/storage');
  context.after(closeDatabase);

  await migrateToLatest();
  const ownerId = randomUUID();
  await db.insertInto('user').values({
    id: ownerId, name: 'Media Owner', email: 'media@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: ownerId, site_name: 'Media Test', default_locale: 'en', timezone: 'UTC',
    admin_path: '/admin', author_avatar_media_id: null,
  }).execute();
  const folder = await db.insertInto('media_folders').values({ owner_id: ownerId, name: 'Covers' })
    .returning('id').executeTakeFirstOrThrow();

  assert.equal(reserveUploadSchema.safeParse({
    originalName: 'bad.svg', mimeType: 'image/svg+xml', sizeBytes: 0, checksumSha256: 'bad', folderId: null, altText: '',
  }).success, false);

  const objects = new Map<string, { body: Buffer; mimeType: string }>();
  const deleted = new Set<string>();
  const failedDeletes = new Set<string>();
  const transport = s3 as unknown as { send(command: object): Promise<object> };
  const originalSend = transport.send;
  transport.send = async (command) => {
    const input: { Key?: unknown } = command instanceof HeadObjectCommand || command instanceof GetObjectCommand || command instanceof DeleteObjectCommand
      ? command.input : {};
    const key = typeof input.Key === 'string' ? input.Key : '';
    if (command instanceof DeleteObjectCommand) {
      if (failedDeletes.has(key)) throw Object.assign(new Error('offline'), { name: 'ServiceUnavailable' });
      objects.delete(key);
      deleted.add(key);
      return {};
    }
    const object = objects.get(key);
    if (!object) throw Object.assign(new Error('missing'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
    const checksum = createHash('sha256').update(object.body).digest('base64');
    if (command instanceof HeadObjectCommand) {
      return { ContentLength: object.body.length, ContentType: object.mimeType, ChecksumSHA256: checksum };
    }
    if (command instanceof GetObjectCommand) return { Body: Readable.from(object.body) };
    throw new Error('Unexpected storage command.');
  };
  context.after(() => { transport.send = originalSend; });

  const png = await sharp({ create: { width: 2, height: 1, channels: 4, background: '#2a9d8f' } }).png().toBuffer();
  const checksum = createHash('sha256').update(png).digest('base64');
  const reservation = await reserveUpload(ownerId, {
    originalName: '../cover.png', mimeType: 'image/png', sizeBytes: png.length, checksumSha256: checksum,
    folderId: folder.id, altText: 'A cover',
  });
  assert.match(reservation.uploadUrl, /^http:\/\/127\.0\.0\.1:59000\//);
  assert.equal(await db.selectFrom('media_items').select('id').executeTakeFirst(), undefined);
  const storedReservation = await db.selectFrom('media_upload_reservations').selectAll()
    .where('id', '=', reservation.id).executeTakeFirstOrThrow();
  objects.set(storedReservation.object_key, { body: png, mimeType: 'image/png' });

  const item = await finalizeUpload(ownerId, reservation.id);
  assert.deepEqual({ width: item.width, height: item.height, publicUrl: item.publicUrl }, {
    width: 2, height: 1, publicUrl: `/media/${item.id}`,
  });
  assert.equal((await db.selectFrom('media_upload_reservations').select('state')
    .where('id', '=', reservation.id).executeTakeFirstOrThrow()).state, 'finalized');
  await assert.rejects(finalizeUpload(ownerId, reservation.id), (error: unknown) => error instanceof HttpError && error.status === 409);

  const bad = Buffer.from('not an image');
  const badChecksum = createHash('sha256').update(bad).digest('base64');
  const badReservation = await reserveUpload(ownerId, {
    originalName: 'spoof.png', mimeType: 'image/png', sizeBytes: bad.length, checksumSha256: badChecksum,
    folderId: null, altText: '',
  });
  const storedBad = await db.selectFrom('media_upload_reservations').select('object_key')
    .where('id', '=', badReservation.id).executeTakeFirstOrThrow();
  objects.set(storedBad.object_key, { body: bad, mimeType: 'image/png' });
  await assert.rejects(finalizeUpload(ownerId, badReservation.id), (error: unknown) => error instanceof HttpError && error.status === 400);
  assert.ok(deleted.has(storedBad.object_key));
  assert.equal((await db.selectFrom('media_upload_reservations').select('state')
    .where('id', '=', badReservation.id).executeTakeFirstOrThrow()).state, 'expired');
  assert.equal(await db.selectFrom('media_items').select('id').where('id', '=', badReservation.id).executeTakeFirst(), undefined);

  const archive = await createFolder(ownerId, 'Archive');
  await assert.rejects(createFolder(ownerId, 'archive'), { code: '23505' });
  assert.equal((await renameFolder(ownerId, archive.id, 'Published')).name, 'Published');
  assert.deepEqual((await listFolders(ownerId)).map((entry) => entry.name), ['Covers', 'Published']);
  await updateMedia(ownerId, item.id, { altText: 'Green cover', folderId: archive.id });
  const page = await listMedia(ownerId, mediaListInputSchema.parse({ folderId: archive.id, page: 1, search: 'green cover' }));
  assert.deepEqual(page.items.map((entry) => entry.id), [item.id]);
  await deleteFolder(ownerId, archive.id);
  assert.equal((await listMedia(ownerId, mediaListInputSchema.parse({ folderId: null, page: 1, search: '' }))).items[0]?.folder_id, null);

  const imageContent = {
    type: 'doc' as const,
    content: [{ type: 'image', attrs: { src: item.publicUrl } }],
  };
  const category = await db.insertInto('categories').values({ owner_id: ownerId, name: 'Uncategorized', is_default: true })
    .returning('id').executeTakeFirstOrThrow();
  const post = await createPost(ownerId, {
    categoryIds: [category.id], coverMediaId: item.id, contentJson: imageContent, metaDescription: null,
    metaTitle: null, slug: 'referenced-post', status: 'draft', title: 'Referenced Post',
  });
  const contentPage = await createPage(ownerId, {
    contentJson: imageContent, metaDescription: null, metaTitle: null,
    slug: 'referenced-page', status: 'draft', title: 'Referenced Page',
  });
  assert.equal(post.cover_media_id, item.id);
  assert.equal(post.content_json.content?.[0]?.attrs?.mediaId, item.id);
  assert.equal(contentPage.content_json.content?.[0]?.attrs?.mediaId, item.id);
  await db.updateTable('site_settings').set({ author_avatar_media_id: item.id }).where('id', '=', true).execute();
  await assert.rejects(deleteMedia(ownerId, item.id), (error: unknown) => {
    if (!(error instanceof HttpError) || error.status !== 409) return false;
    const references = error.details?.references as { counts?: Record<string, number> } | undefined;
    return references?.counts?.postCovers === 1 && references.counts.postContent === 1
      && references.counts.pageContent === 1 && references.counts.profile === 1;
  });
  await db.updateTable('site_settings').set({ author_avatar_media_id: null }).where('id', '=', true).execute();
  await db.deleteFrom('posts').where('id', '=', post.id).execute();
  await db.deleteFrom('pages').where('id', '=', contentPage.id).execute();
  failedDeletes.add(storedReservation.object_key);
  await assert.rejects(deleteMedia(ownerId, item.id), (error: unknown) => error instanceof HttpError && error.status === 503);
  assert.equal((await db.selectFrom('media_items').select('state').where('id', '=', item.id).executeTakeFirstOrThrow()).state, 'delete_failed');
  failedDeletes.delete(storedReservation.object_key);
  await deleteMedia(ownerId, item.id);
  assert.equal(await db.selectFrom('media_items').select('id').where('id', '=', item.id).executeTakeFirst(), undefined);
  assert.ok(deleted.has(storedReservation.object_key));
});
