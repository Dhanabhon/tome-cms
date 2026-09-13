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
  const { HttpError } = await import('../../src/server/http/errors');
  const { finalizeUpload, reserveUpload, reserveUploadSchema } = await import('../../src/server/media/service');
  const { s3 } = await import('../../src/server/media/storage');
  context.after(closeDatabase);

  await migrateToLatest();
  const ownerId = randomUUID();
  await db.insertInto('user').values({
    id: ownerId, name: 'Media Owner', email: 'media@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  const folder = await db.insertInto('media_folders').values({ owner_id: ownerId, name: 'Covers' })
    .returning('id').executeTakeFirstOrThrow();

  assert.equal(reserveUploadSchema.safeParse({
    originalName: 'bad.svg', mimeType: 'image/svg+xml', sizeBytes: 0, checksumSha256: 'bad', folderId: null, altText: '',
  }).success, false);

  const objects = new Map<string, { body: Buffer; mimeType: string }>();
  const deleted = new Set<string>();
  const transport = s3 as unknown as { send(command: object): Promise<object> };
  const originalSend = transport.send;
  transport.send = async (command) => {
    const input: { Key?: unknown } = command instanceof HeadObjectCommand || command instanceof GetObjectCommand || command instanceof DeleteObjectCommand
      ? command.input : {};
    const key = typeof input.Key === 'string' ? input.Key : '';
    if (command instanceof DeleteObjectCommand) {
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
  assert.deepEqual({ width: item.width, height: item.height, stablePath: item.stablePath }, {
    width: 2, height: 1, stablePath: `/media/${item.id}`,
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
});
