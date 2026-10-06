import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('base64');
const picture = (width: number, height: number) =>
  sharp({ create: { background: '#2a9d8f', channels: 3, height, width } }).jpeg().toBuffer();

test('images kept before copies were made get theirs once, and /media serves them by width', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { backfillVariants, queueVariants, serially, variantsIdle } = await import('../../src/server/media/variants');
  const { resolveMediaUrl } = await import('../../src/server/media/url');
  const { s3, s3Bucket } = await import('../../src/server/media/storage');
  const { GET } = await import('../../src/pages/media/[id]');
  context.after(closeDatabase);

  await migrateToLatest();
  await db.deleteFrom('app_metadata').where('key', '=', 'media_variants_backfill').execute();
  const ownerId = randomUUID();
  await db.insertInto('user').values({
    id: ownerId, name: 'Owner', email: 'backfill@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();

  // An image as an older version kept it: its object and its row, measured from the raw pixels.
  let minute = 0;
  const before = async (name: string, body: Buffer | null, size: { width: number; height: number }, mime: 'image/jpeg' | 'image/gif' = 'image/jpeg') => {
    const key = `owners/${ownerId}/2026/01/${randomUUID()}.${mime === 'image/jpeg' ? 'jpg' : 'gif'}`;
    if (body) await s3.send(new PutObjectCommand({ Body: body, Bucket: s3Bucket, ContentType: mime, Key: key }));
    minute += 1;
    return db.insertInto('media_items').values({
      owner_id: ownerId, folder_id: null, object_key: key, original_name: name, mime_type: mime,
      size_bytes: body?.length ?? 1, checksum_sha256: sha(body ?? Buffer.from('x')), alt_text: null,
      state: 'ready', delete_error_code: null, created_at: new Date(Date.UTC(2026, 0, 1, 0, minute)), ...size,
    }).returningAll().executeTakeFirstOrThrow();
  };
  const variantsOf = async (mediaId: string) => (await db.selectFrom('media_variants').select('width')
    .where('media_id', '=', mediaId).orderBy('width').execute()).map(({ width }) => width);
  const cutoff = async () => (await db.selectFrom('app_metadata').select('value')
    .where('key', '=', 'media_variants_backfill').executeTakeFirst())?.value;
  const sizeOf = (mediaId: string) => db.selectFrom('media_items').select(['width', 'height'])
    .where('id', '=', mediaId).executeTakeFirstOrThrow();

  // The oldest cannot be read as a picture at all; it must not hold back the ones after it.
  const broken = await before('broken.jpg', Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]), { width: 2000, height: 1000 });
  const missing = await before('missing.jpg', null, { width: 2000, height: 1000 });
  const wide = await before('wide.jpg', await picture(2000, 1000), { width: 2000, height: 1000 });
  // Taken on its side: kept as 2000 × 1000 raw pixels, seen 1000 wide and 2000 high.
  const turned = await before('turned.jpg', await sharp({ create: { background: '#c33', channels: 3, height: 1000, width: 2000 } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer(), { width: 2000, height: 1000 });
  const small = await before('small.jpg', await picture(300, 200), { width: 300, height: 200 });
  const frame = (background: string) => sharp({ create: { background, channels: 4, height: 600, width: 1200 } }).png().toBuffer();
  const animated = await before('moving.gif', await sharp([await frame('#fff'), await frame('#c33')], { join: { animated: true } })
    .gif({ loop: 0 }).toBuffer(), { width: 1200, height: 600 }, 'image/gif');

  const transport = s3 as unknown as { send(command: object): Promise<object> };
  const originalSend = transport.send;
  const reads: string[] = [];
  let failReads = false;
  transport.send = async function (this: unknown, command: object) {
    if (command instanceof GetObjectCommand) {
      reads.push(command.input.Key!);
      if (failReads) throw Object.assign(new Error('offline'), { name: 'ServiceUnavailable' });
    }
    return originalSend.call(s3, command);
  };
  const logs: { info: unknown[][]; error: unknown[][] } = { info: [], error: [] };
  const original = { info: console.info, error: console.error };
  console.info = (...args: unknown[]) => { logs.info.push(args); };
  console.error = (...args: unknown[]) => { logs.error.push(args); };
  context.after(() => {
    transport.send = originalSend;
    Object.assign(console, original);
  });

  // A storage that fails stops the walk quietly, with one line of counts, and leaves it for the next start.
  failReads = true;
  await backfillVariants();
  failReads = false;
  assert.deepEqual(logs.info, []);
  assert.deepEqual(logs.error, [[
    'Images stopped getting their smaller copies; the next start tries again.',
    { corrected: 0, gone: 0, made: 0, none: 0, unreadable: 0, error: 'ServiceUnavailable' },
  ]]);
  assert.equal(reads.length, 1, 'it stops at the first failure');
  assert.deepEqual(await variantsOf(wide.id), []);
  assert.equal(await cutoff(), undefined, 'a stopped walk leaves no point to begin from');
  logs.error.length = 0;
  reads.length = 0;

  // The next start walks them all, oldest first, one at a time, and says what it did in one line.
  const secondStart = Date.now();
  await backfillVariants();
  assert.deepEqual(logs.error, []);
  assert.deepEqual(logs.info, [[
    'Images were given their smaller copies.',
    { corrected: 1, gone: 1, made: 2, none: 2, unreadable: 1 },
  ]]);
  const walked = await cutoff();
  assert.ok(walked && Date.parse(walked) >= secondStart && Date.parse(walked) <= Date.now(), 'a finished walk keeps its start');
  assert.deepEqual(reads, [broken, missing, wide, turned, small, animated].map(({ object_key: key }) => key));
  assert.deepEqual(await variantsOf(wide.id), [480, 960, 1600]);
  assert.deepEqual(await variantsOf(turned.id), [480, 960]);
  assert.deepEqual(await sizeOf(turned.id), { width: 1000, height: 2000 }, 'the turned photo is measured upright');
  assert.deepEqual(await sizeOf(wide.id), { width: 2000, height: 1000 });
  assert.deepEqual(await variantsOf(small.id), []);
  assert.deepEqual(await variantsOf(animated.id), []);
  assert.deepEqual(await variantsOf(broken.id), []);

  // Once the library has been walked, a start reads nothing again: not the small, the moving or the broken.
  logs.info.length = 0;
  reads.length = 0;
  await backfillVariants();
  assert.deepEqual(reads, []);
  assert.deepEqual(logs.info, []);

  // An upload after that walk whose copies failed is left to the next start, which reads only it.
  const late = await before('late.jpg', await picture(1200, 600), { width: 1200, height: 600 });
  await db.updateTable('media_items').set({ created_at: new Date() }).where('id', '=', late.id).execute();
  const stopping = await cutoff();
  failReads = true;
  await backfillVariants();
  failReads = false;
  assert.equal(await cutoff(), stopping, 'a stopped walk leaves the last point as it was');
  assert.deepEqual(reads, [late.object_key]);
  logs.error.length = 0;
  reads.length = 0;
  await backfillVariants();
  assert.deepEqual(reads, [late.object_key], 'nothing before the last walk is read again');
  assert.deepEqual(await variantsOf(late.id), [480, 960]);
  assert.deepEqual(logs.info, [['Images were given their smaller copies.', { corrected: 0, gone: 0, made: 1, none: 0, unreadable: 0 }]]);
  assert.ok(Date.parse((await cutoff())!) > Date.parse(stopping!));
  logs.info.length = 0;
  reads.length = 0;

  // An image deleted while its copies waited in line has nothing to do, and nothing is logged.
  let release!: () => void;
  const gate = serially(() => new Promise<void>((resolve) => { release = resolve; }));
  queueVariants({ id: small.id, object_key: small.object_key, owner_id: ownerId }, await picture(300, 200));
  queueVariants({ id: randomUUID(), object_key: `owners/${ownerId}/2026/01/${randomUUID()}.jpg`, owner_id: ownerId }, await picture(2000, 1000));
  release();
  await gate;
  await variantsIdle();
  assert.deepEqual(logs.error, []);

  // /media/<id>?w= sends a width that has a copy to the copy, and anything else to the original.
  const location = async (id: string, query = '') => {
    const response = await GET({ params: { id }, url: new URL(`http://localhost/media/${id}${query}`) } as never);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=300, stale-while-revalidate=86400');
    return response.headers.get('Location');
  };
  const copyOf = async (id: string, width: 480 | 960 | 1600) => resolveMediaUrl((await db.selectFrom('media_variants')
    .select('object_key').where('media_id', '=', id).where('width', '=', width).executeTakeFirstOrThrow()).object_key);
  const originalOf = resolveMediaUrl(wide.object_key);
  assert.equal(await location(wide.id), originalOf);
  assert.equal(await location(wide.id, '?w=480'), await copyOf(wide.id, 480));
  assert.equal(await location(wide.id, '?w=960'), await copyOf(wide.id, 960));
  assert.equal(await location(wide.id, '?w=1600'), await copyOf(wide.id, 1600));
  for (const other of ['?w=500', '?w=0480', '?w=', '?width=480']) assert.equal(await location(wide.id, other), originalOf, other);
  assert.equal(await location(turned.id, '?w=1600'), resolveMediaUrl(turned.object_key), 'no copy at that width');
  assert.equal(await location(small.id, '?w=480'), resolveMediaUrl(small.object_key));
});
