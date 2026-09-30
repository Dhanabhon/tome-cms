import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';

import { GetObjectCommand } from '@aws-sdk/client-s3';

test('a PDF is read back through the app: only its owner, only a ready PDF, by range, never a stack', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { HttpError } = await import('../../src/server/http/errors');
  const { readPdf } = await import('../../src/server/media/content');
  const { s3 } = await import('../../src/server/media/storage');
  context.after(closeDatabase);

  await migrateToLatest();
  // Better Auth checks the schema when it is first loaded, so the route is loaded once the tables are there.
  const { GET } = await import('../../src/pages/api/admin/media/[id]/content');
  const ownerId = randomUUID();
  const otherId = randomUUID();
  for (const [id, email] of [[ownerId, 'pdf-owner@example.invalid'], [otherId, 'pdf-other@example.invalid']]) {
    await db.insertInto('user').values({ id, name: 'Owner', email, emailVerified: true, image: null, role: 'owner' }).execute();
  }
  await db.insertInto('site_settings').values({
    id: true, owner_id: ownerId, site_name: 'PDF', default_locale: 'en', timezone: 'UTC', admin_path: '/admin', author_avatar_media_id: null,
  }).execute();

  const pdf = Buffer.from('%PDF-1.4\n' + 'x'.repeat(300));
  const stored = { folder_id: null, checksum_sha256: `${'A'.repeat(43)}=`, alt_text: null, delete_error_code: null };
  const item = async (owner: string, mime: string, state: 'ready' | 'deleting', name = 'a.pdf') => (await db.insertInto('media_items').values({
    ...stored, owner_id: owner, state, object_key: `owners/${owner}/2026/09/${randomUUID()}.${name.split('.')[1]}`, original_name: name,
    mime_type: mime as 'application/pdf', size_bytes: pdf.length, width: mime.startsWith('image/') ? 2 : null, height: mime.startsWith('image/') ? 1 : null,
  }).returning(['id', 'object_key']).executeTakeFirstOrThrow());
  const ready = await item(ownerId, 'application/pdf', 'ready');
  const image = await item(ownerId, 'image/png', 'ready', 'a.png');
  const leaving = await item(ownerId, 'application/pdf', 'deleting');
  const foreign = await item(otherId, 'application/pdf', 'ready');

  // What storage answers: the whole object, or the one range asked for, with its Content-Range.
  const asked: Array<{ Key?: string; Range?: string }> = [];
  let failure: unknown = null;
  // What the SDK hands back: a Node stream that can also become a web stream.
  const body = (bytes: Buffer) => {
    const stream = Readable.from([bytes]);
    return Object.assign(stream, { transformToWebStream: () => Readable.toWeb(stream) });
  };
  const transport = s3 as unknown as { send(command: object): Promise<object> };
  const originalSend = transport.send;
  transport.send = async (command) => {
    if (!(command instanceof GetObjectCommand)) throw new Error('Unexpected storage command.');
    asked.push(command.input);
    if (failure) throw failure;
    const range = /^bytes=(\d+)-(\d*)$/.exec(command.input.Range ?? '');
    if (!range) return { Body: body(pdf), ContentLength: pdf.length };
    const start = Number(range[1]);
    if (start >= pdf.length) throw Object.assign(new Error('range'), { name: 'InvalidRange', $metadata: { httpStatusCode: 416 } });
    const end = Math.min(range[2] ? Number(range[2]) : pdf.length - 1, pdf.length - 1);
    return { Body: body(pdf.subarray(start, end + 1)), ContentLength: end - start + 1, ContentRange: `bytes ${start}-${end}/${pdf.length}` };
  };
  context.after(() => { transport.send = originalSend; });

  const notFound = (error: unknown) => error instanceof HttpError && error.status === 404;

  const whole = await readPdf(ownerId, ready.id, null);
  assert.equal(whole.status, 200);
  assert.deepEqual(Buffer.from(await whole.arrayBuffer()), pdf);
  assert.equal(whole.headers.get('content-type'), 'application/pdf');
  assert.equal(whole.headers.get('content-length'), String(pdf.length));
  assert.equal(whole.headers.get('accept-ranges'), 'bytes');
  assert.equal(whole.headers.get('cache-control'), 'private, max-age=300');
  assert.equal(whole.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(whole.headers.get('content-disposition'), 'inline');
  assert.equal(whole.headers.has('content-range'), false);
  // The internal client, for the object's own key, with no range.
  assert.deepEqual(asked.at(-1), { Bucket: 'tomecms-test-media', Key: ready.object_key });

  const part = await readPdf(ownerId, ready.id, 'bytes=0-99');
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 0-99/${pdf.length}`);
  assert.equal(part.headers.get('content-length'), '100');
  assert.equal(part.headers.get('accept-ranges'), 'bytes');
  assert.equal(part.headers.get('content-disposition'), 'inline');
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), pdf.subarray(0, 100));
  assert.equal(asked.at(-1)?.Range, 'bytes=0-99', 'the header goes to storage as it came');

  for (const bad of ['bytes=9-2', 'pages=1-2', 'bytes=0-1,5-6', 'bytes=']) {
    await assert.rejects(readPdf(ownerId, ready.id, bad), (error) => error instanceof HttpError && error.status === 416, bad);
  }
  await assert.rejects(readPdf(ownerId, ready.id, `bytes=${pdf.length + 10}-`), (error) => error instanceof HttpError && error.status === 416);

  // Not this owner's, not ready, not a PDF, not there: one answer, and storage is never asked.
  const before = asked.length;
  for (const [owner, id] of [[ownerId, foreign.id], [ownerId, leaving.id], [ownerId, image.id], [ownerId, randomUUID()]]) {
    await assert.rejects(readPdf(owner, id, null), notFound);
  }
  assert.equal(asked.length, before);

  // An object the database has and storage has not is also "not found"; any other failure is 503 without its text.
  failure = Object.assign(new Error('missing'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
  await assert.rejects(readPdf(ownerId, ready.id, null), notFound);
  failure = Object.assign(new Error('secret endpoint http://seaweedfs:8333'), { name: 'InternalError', $metadata: { httpStatusCode: 500 } });
  const logged: string[] = [];
  const error = console.error;
  console.error = (...values: unknown[]) => { logged.push(values.map(String).join(' ')); };
  try {
    await assert.rejects(readPdf(ownerId, ready.id, null), (caught) => caught instanceof HttpError && caught.status === 503 && !caught.message.includes('seaweedfs'));
  } finally {
    console.error = error;
  }
  assert.equal(logged.some((line) => line.includes('seaweedfs')), false);
  failure = null;

  // The route: no session, no answer, and storage is not asked.
  const calls = asked.length;
  const response = await GET({
    params: { id: ready.id }, request: new Request(`http://localhost:4321/api/admin/media/${ready.id}/content`),
  } as unknown as Parameters<typeof GET>[0]);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(asked.length, calls);
});
