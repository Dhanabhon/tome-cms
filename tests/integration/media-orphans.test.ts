import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { sql } from 'kysely';

const DAY = 24 * 60 * 60 * 1000;

/**
 * The sweep against the real bucket: of every object a row points at, an object too young to
 * judge, another app's object and the ones nothing points at, only the last are listed and
 * deleted. A dry run deletes nothing, and an object a row comes to point at mid-sweep is kept.
 */
test('the sweep lists and deletes only old TomeCMS objects that nothing points at', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { s3, s3Bucket } = await import('../../src/server/media/storage');
  const { sweepOrphans, ORPHAN_KEYS_SHOWN } = await import('../../src/server/media/orphans');
  context.after(closeDatabase);

  await migrateToLatest();
  const owner = randomUUID();
  await db.insertInto('user').values({ id: owner, name: 'Owner', email: 'orphans@example.invalid', emailVerified: true, image: null, role: 'owner' }).execute();

  // The bucket outlives each file's database; start it empty so every count here is this test's.
  const everything = async () => {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const page = await s3.send(new ListObjectsV2Command({ Bucket: s3Bucket, ContinuationToken: token }));
      keys.push(...(page.Contents ?? []).map(({ Key }) => Key!));
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return keys.sort();
  };
  const leftover = await everything();
  if (leftover.length) await s3.send(new DeleteObjectsCommand({ Bucket: s3Bucket, Delete: { Objects: leftover.map((Key) => ({ Key })) } }));

  const key = (extension = 'jpg') => `owners/${owner}/2026/10/${randomUUID()}.${extension}`;
  const original = key();
  const variant = key('webp');
  const brand = key('png');
  const reserved = key();
  const race = key();
  const orphans = Array.from({ length: ORPHAN_KEYS_SHOWN + 2 }, () => key());
  const foreign = 'another-app/notes.txt';
  const young = key();
  const body = Buffer.from('bytes');
  const sha = createHash('sha256').update(body).digest('base64');

  const media = await db.insertInto('media_items').values({
    id: randomUUID(), owner_id: owner, folder_id: null, object_key: original, original_name: 'a.jpg', mime_type: 'image/jpeg',
    size_bytes: body.length, checksum_sha256: sha, width: 1000, height: 500, alt_text: null, state: 'ready', delete_error_code: null,
  }).returning('id').executeTakeFirstOrThrow();
  await db.insertInto('media_variants').values({ media_id: media.id, width: 480, object_key: variant, size_bytes: body.length }).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: owner, site_name: 'Orphans', default_locale: 'en', timezone: 'UTC', admin_path: '/admin',
    brand_logo: sql`${JSON.stringify({ key: brand, mime: 'image/png', width: 400, height: 100 })}::jsonb`,
  }).execute();
  await db.insertInto('media_upload_reservations').values({
    owner_id: owner, folder_id: null, object_key: reserved, original_name: 'b.jpg', mime_type: 'image/jpeg',
    expected_size_bytes: body.length, expected_checksum_sha256: sha, alt_text: null, state: 'pending',
    expires_at: new Date(Date.now() + 60_000), finalized_at: null,
  }).execute();

  // The sweep's keys and reset's list come from the same sources.
  const { knownObjects, trackedKeys } = await import('../../src/server/media/tracked-objects');
  const known = await knownObjects(db);
  assert.deepEqual([...await trackedKeys(db)].sort(), known.map(({ key }) => key).sort());
  assert.deepEqual(known.map(({ key }) => key).sort(), [original, variant, brand, reserved].sort());
  assert.deepEqual(known.find(({ key }) => key === variant)?.ids, [media.id], 'a copy is accounted for by its image');
  assert.deepEqual([...await trackedKeys(db, [variant, race])], [variant]);

  const put = (Key: string) => s3.send(new PutObjectCommand({ Bucket: s3Bucket, Key, Body: body }));
  await Promise.all([original, variant, brand, reserved, race, foreign, ...orphans].map(put));
  // Object times are whole seconds; the young one is stored a second later, and the sweep's clock
  // is set so that it alone is under a day old.
  await delay(1_100);
  await put(young);
  const listed = (await s3.send(new ListObjectsV2Command({ Bucket: s3Bucket }))).Contents ?? [];
  const youngAt = listed.find(({ Key }) => Key === young)!.LastModified!.getTime();
  assert.ok(listed.every(({ Key, LastModified }) => Key === young || LastModified!.getTime() < youngAt));
  const now = new Date(youngAt + DAY - 1);
  const before = await everything();
  const swept = [...orphans, race].sort();

  // The dry run, a few keys a page: it counts, names the first 50, and deletes nothing.
  const dry = await sweepOrphans({ storage: s3, bucket: s3Bucket, database: db, execute: false, now, pageSize: 7 });
  assert.equal(dry.count, swept.length);
  assert.equal(dry.bytes, swept.length * body.length);
  assert.deepEqual(dry.keys, swept.slice(0, ORPHAN_KEYS_SHOWN));
  assert.deepEqual({ deleted: dry.deleted, failed: dry.failed, kept: dry.kept }, { deleted: 0, failed: 0, kept: 0 });
  assert.deepEqual(await everything(), before);

  // Run for real, a row comes to point at one after it was listed, and one delete batch fails:
  // that one is kept, the failure is counted, and the rest still go.
  const transport = s3 as unknown as { send(command: object): Promise<unknown> };
  const send = transport.send;
  let failedOnce = false;
  transport.send = async function (this: unknown, command: object) {
    if (command instanceof DeleteObjectsCommand && !failedOnce && !command.input.Delete!.Objects!.some(({ Key }) => Key === race)) {
      failedOnce = true;
      throw Object.assign(new Error('offline'), { name: 'ServiceUnavailable' });
    }
    const result = await send.call(s3, command);
    if (command instanceof ListObjectsV2Command && (result as { Contents?: Array<{ Key?: string }> }).Contents?.some(({ Key }) => Key === race)) {
      await db.insertInto('media_items').values({
        id: randomUUID(), owner_id: owner, folder_id: null, object_key: race, original_name: 'c.jpg', mime_type: 'image/jpeg',
        size_bytes: body.length, checksum_sha256: sha, width: 10, height: 10, alt_text: null, state: 'ready', delete_error_code: null,
      }).onConflict((conflict) => conflict.doNothing()).execute();
    }
    return result;
  };
  let first;
  try {
    first = await sweepOrphans({ storage: s3, bucket: s3Bucket, database: db, execute: true, now, pageSize: 7 });
  } finally {
    transport.send = send;
  }
  assert.equal(first.count, swept.length);
  assert.equal(first.kept, 1);
  assert.ok(first.failed > 0);
  assert.equal(first.deleted + first.failed + first.kept, swept.length);

  // The failed ones are still there, and a second run takes them.
  const second = await sweepOrphans({ storage: s3, bucket: s3Bucket, database: db, execute: true, now, pageSize: 7 });
  assert.deepEqual({ count: second.count, deleted: second.deleted, failed: second.failed, kept: second.kept },
    { count: first.failed, deleted: first.failed, failed: 0, kept: 0 });
  assert.deepEqual(await everything(), [original, variant, brand, reserved, race, foreign, young].sort());

  // At the real time, nothing stored a moment ago is old enough to go.
  await put(key());
  assert.equal((await sweepOrphans({ storage: s3, bucket: s3Bucket, database: db, execute: false })).count, 0);
});
