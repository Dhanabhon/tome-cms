import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import sharp from 'sharp';

test('a fetched poster becomes a ready picture in the library, and the route answers with it', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { HttpError } = await import('../../src/server/http/errors');
  const { importImage } = await import('../../src/server/media/service');
  const { s3, s3Bucket } = await import('../../src/server/media/storage');
  const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
  const { resolveVideo } = await import('../../src/server/video/resolve');
  context.after(closeDatabase);

  await migrateToLatest();
  const ownerId = randomUUID();
  await db.insertInto('user').values({ id: ownerId, name: 'Owner', email: 'poster@example.invalid', emailVerified: true, image: null, role: 'owner' }).execute();
  const jpeg = await sharp({ create: { background: '#336699', channels: 3, height: 360, width: 480 } }).jpeg().toBuffer();

  const kept = await importImage(ownerId, jpeg, 'A clip worth watching');
  assert.deepEqual({ height: kept.height, mime: kept.mime_type, name: kept.original_name, width: kept.width }, { height: 360, mime: 'image/jpeg', name: 'A clip worth watching', width: 480 });
  const row = await db.selectFrom('media_items').select(['object_key', 'state', 'size_bytes']).where('id', '=', kept.id).executeTakeFirstOrThrow();
  assert.equal(row.state, 'ready');
  // size_bytes is bigint; the driver hands it back as a string (see src/server/db/types.ts).
  assert.equal(row.size_bytes, String(jpeg.length));
  const head = await s3.send(new HeadObjectCommand({ Bucket: s3Bucket, Key: row.object_key }));
  assert.equal(head.ContentLength, jpeg.length);

  await assert.rejects(importImage(ownerId, Buffer.from('not a picture'), 'x'), (error: unknown) => error instanceof HttpError && error.status === 415);

  const answered = await resolveVideo(ownerId, 'https://youtu.be/dQw4w9WgXcQ?t=30', async () => ({ poster: jpeg, reason: null, title: 'A clip' }));
  assert.equal(answered.provider, 'youtube');
  assert.equal(answered.start, 30);
  assert.equal(answered.title, 'A clip');
  assert.equal(answered.reason, null);
  assert.ok(answered.mediaId, 'the poster is kept');

  const bare = await resolveVideo(ownerId, 'https://vimeo.com/76979871', async () => ({ poster: null, reason: 'unavailable', title: '' }));
  assert.deepEqual(bare, { mediaId: null, provider: 'vimeo', reason: 'unavailable', start: null, title: '', videoId: '76979871' });

  await assert.rejects(resolveVideo(ownerId, 'https://example.com/clip', async () => { throw new Error('never asked'); }),
    (error: unknown) => error instanceof HttpError && error.status === 400);
});
