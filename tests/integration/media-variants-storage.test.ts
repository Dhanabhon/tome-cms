import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('base64');
const picture = (width: number, height: number, background = '#2a9d8f') =>
  sharp({ create: { background, channels: 3, height, width } }).jpeg().toBuffer();

test('an image keeps smaller copies for as long as it is kept itself', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { HttpError } = await import('../../src/server/http/errors');
  const { createMediaFromBytes, deleteMedia, finalizeUpload, reserveUpload } = await import('../../src/server/media/service');
  const { storeVariants, variantsIdle } = await import('../../src/server/media/variants');
  const { isTomeObjectKey } = await import('../../src/server/media/keys');
  const { s3, s3Bucket } = await import('../../src/server/media/storage');
  const { knownObjects } = await import('../../scripts/reset-installation.mjs');
  const { resolveStoredCandidate } = await import('../../scripts/media-cleanup');
  context.after(closeDatabase);

  await migrateToLatest();
  const ownerId = randomUUID();
  await db.insertInto('user').values({
    id: ownerId, name: 'Owner', email: 'variants@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();

  const head = async (key: string) => {
    try {
      return await s3.send(new HeadObjectCommand({ Bucket: s3Bucket, Key: key }));
    } catch {
      return null;
    }
  };
  const variantsOf = (mediaId: string) => db.selectFrom('media_variants').selectAll()
    .where('media_id', '=', mediaId).orderBy('width').execute();
  const upload = async (body: Buffer) => {
    const reservation = await reserveUpload(ownerId, {
      originalName: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: body.length, checksumSha256: sha(body), folderId: null, altText: '',
    });
    assert.equal((await fetch(reservation.uploadUrl, {
      method: 'PUT', headers: reservation.headers as Record<string, string>, body: new Uint8Array(body),
    })).status, 200);
    return finalizeUpload(ownerId, reservation.id);
  };

  // A finished upload is answered at once; its copies follow, one image at a time.
  const photo = await upload(await picture(2000, 1000));
  assert.equal(photo.width, 2000);
  await variantsIdle();
  const copies = await variantsOf(photo.id);
  assert.deepEqual(copies.map(({ width }) => width), [480, 960, 1600]);
  for (const copy of copies) {
    assert.ok(isTomeObjectKey(copy.object_key), 'a copy fits the key grammar backup and reset accept');
    assert.match(copy.object_key, new RegExp(`^owners/${ownerId}/\\d{4}/\\d{2}/[0-9a-f-]{36}\\.webp$`));
    const stored = await head(copy.object_key);
    assert.equal(stored?.ContentType, 'image/webp');
    assert.equal(stored?.CacheControl, 'public, max-age=31536000, immutable');
    assert.equal(stored?.ContentLength, copy.size_bytes);
  }
  const known = new Set((await knownObjects(db)).map(({ key }: { key: string }) => key));
  for (const copy of copies) assert.ok(known.has(copy.object_key), 'a reset accounts for every copy');

  // An imported picture gets its copies too; one narrower than every width gets none.
  const imported = await createMediaFromBytes(ownerId, await picture(1000, 500), 'imported.jpg');
  const small = await createMediaFromBytes(ownerId, await picture(300, 200), 'small.jpg');
  await variantsIdle();
  assert.deepEqual((await variantsOf(imported.id)).map(({ width }) => width), [480, 960]);
  assert.deepEqual(await variantsOf(small.id), []);

  // A copy that cannot be stored fails nothing: the upload is ready, the reason is logged by id
  // alone, and what was stored of the copies is taken back.
  const transport = s3 as unknown as { send(command: object): Promise<object> };
  const originalSend = transport.send;
  const putKeys: string[] = [];
  transport.send = async function (this: unknown, command: object) {
    if (command instanceof PutObjectCommand && command.input.ContentType === 'image/webp') {
      putKeys.push(command.input.Key!);
      if (putKeys.length === 2) throw Object.assign(new Error('offline'), { name: 'ServiceUnavailable' });
    }
    return originalSend.call(s3, command);
  };
  const logged: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { logged.push(args); };
  let failed;
  try {
    failed = await upload(await picture(1200, 800, '#e76f51'));
    await variantsIdle();
  } finally {
    transport.send = originalSend;
    console.error = originalError;
  }
  assert.equal((await db.selectFrom('media_items').select('state').where('id', '=', failed.id).executeTakeFirstOrThrow()).state, 'ready');
  assert.deepEqual(await variantsOf(failed.id), []);
  assert.deepEqual(logged, [['Image variants could not be made.', { mediaId: failed.id, error: 'ServiceUnavailable' }]]);
  assert.equal(putKeys.length, 2);
  for (const key of putKeys) assert.equal(await head(key), null, 'a half-made set of copies is not left behind');

  // An image deleted before its copies are written gets none, and none of their objects remain.
  const going = await db.insertInto('media_items').values({
    id: randomUUID(), owner_id: ownerId, folder_id: null, object_key: `owners/${ownerId}/2026/10/${randomUUID()}.jpg`,
    original_name: 'going.jpg', mime_type: 'image/jpeg', size_bytes: 1, checksum_sha256: sha(Buffer.from('x')),
    width: 1000, height: 500, alt_text: null, state: 'deleting', delete_error_code: null,
  }).returningAll().executeTakeFirstOrThrow();
  const before = (await knownObjects(db)).length;
  await assert.rejects(storeVariants(going, await picture(1000, 500)));
  assert.deepEqual(await variantsOf(going.id), []);
  assert.equal((await knownObjects(db)).length, before);
  await db.deleteFrom('media_items').where('id', '=', going.id).execute();

  // Deleting an image deletes its copies' objects, then the rows go with it.
  await deleteMedia(ownerId, photo.id);
  for (const copy of copies) assert.equal(await head(copy.object_key), null, `${copy.width} was left behind`);
  assert.deepEqual(await variantsOf(photo.id), []);

  // A copy that cannot be deleted leaves the image to be deleted again, as its original would.
  const importedCopies = await variantsOf(imported.id);
  transport.send = async function (this: unknown, command: object) {
    if ((command as { input?: { Key?: string } }).input?.Key === importedCopies[0]!.object_key) {
      throw Object.assign(new Error('offline'), { name: 'ServiceUnavailable' });
    }
    return originalSend.call(s3, command);
  };
  try {
    await assert.rejects(deleteMedia(ownerId, imported.id), (error: unknown) => error instanceof HttpError && error.status === 503);
  } finally {
    transport.send = originalSend;
  }
  assert.equal((await db.selectFrom('media_items').select('state').where('id', '=', imported.id).executeTakeFirstOrThrow()).state, 'delete_failed');
  assert.ok(await head(importedCopies[0]!.object_key), 'the copy is still accounted for');

  // The cleanup script removes a failed image's copies along with it.
  const removed: string[] = [];
  const { object_key: importedKey } = await db.selectFrom('media_items').select('object_key').where('id', '=', imported.id).executeTakeFirstOrThrow();
  assert.equal(await resolveStoredCandidate(db, { id: imported.id, kind: 'media', objectKey: importedKey }, async (key) => {
    removed.push(key);
    await s3.send(new DeleteObjectCommand({ Bucket: s3Bucket, Key: key }));
  }), true);
  assert.deepEqual(removed.sort(), [importedKey, ...importedCopies.map(({ object_key: key }) => key)].sort());
  assert.deepEqual(await variantsOf(imported.id), []);
  for (const copy of importedCopies) assert.equal(await head(copy.object_key), null);

  await deleteMedia(ownerId, small.id);
  await deleteMedia(ownerId, failed.id);
});
