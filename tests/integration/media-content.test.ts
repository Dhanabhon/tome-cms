import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';

import { runWithEndpointContext } from '@better-auth/core/context';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { makeSignature } from 'better-auth/crypto';

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
  const signals: Array<AbortSignal | undefined> = [];
  let failure: unknown = null;
  // What the SDK hands back: a Node stream that can also become a web stream.
  const body = (bytes: Buffer) => {
    const stream = Readable.from([bytes]);
    return Object.assign(stream, { transformToWebStream: () => Readable.toWeb(stream) });
  };
  const transport = s3 as unknown as { send(command: object, options?: object): Promise<object> };
  const originalSend = transport.send;
  transport.send = async (command, options) => {
    if (!(command instanceof GetObjectCommand)) throw new Error('Unexpected storage command.');
    asked.push(command.input);
    signals.push((options as { abortSignal?: AbortSignal } | undefined)?.abortSignal);
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

  // A range that cannot be served is 416 with the file's size, as RFC 9110 has it, and never reaches storage if it is malformed.
  const refusedAt = async (response: Response) => {
    assert.equal(response.status, 416);
    assert.equal(response.headers.get('content-range'), `bytes */${pdf.length}`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json() as { requestId: string }).requestId, 'req-416');
  };
  const beforeMalformed = asked.length;
  for (const bad of ['bytes=9-2', 'pages=1-2', 'bytes=0-1,5-6', 'bytes=']) await refusedAt(await readPdf(ownerId, ready.id, bad, { requestId: 'req-416' }));
  assert.equal(asked.length, beforeMalformed);
  await refusedAt(await readPdf(ownerId, ready.id, `bytes=${pdf.length + 10}-`, { requestId: 'req-416' }));

  // The answer is named by request, and storage is asked with the request's own abort signal: a reader that leaves stops the read.
  const leaving_ = new AbortController();
  const named = await readPdf(ownerId, ready.id, null, { requestId: 'req-200', signal: leaving_.signal });
  assert.equal(named.headers.get('x-request-id'), 'req-200');
  assert.equal(signals.at(-1), leaving_.signal);
  await named.arrayBuffer();

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

  // A signed-in owner, as a browser would be: the session is bound to a passkey, and sends its cookie.
  await db.insertInto('passkey').values({
    id: 'route-passkey', name: 'Route', publicKey: 'route-key', userId: ownerId, credentialID: 'route-credential', counter: 0,
    deviceType: 'singleDevice', backedUp: false, transports: '', aaguid: null,
  }).execute();
  const { auth } = await import('../../src/server/auth/config');
  const authContext = await auth.$context;
  const session = await runWithEndpointContext({
    context: authContext as unknown as Parameters<typeof runWithEndpointContext>[0]['context'],
    path: '/passkey/verify-authentication',
    body: { response: { id: 'route-credential' } },
  }, () => authContext.internalAdapter.createSession(ownerId));
  const cookie = `${authContext.authCookies.sessionToken.name}=${session.token}.${await makeSignature(session.token, authContext.secret)}`;
  const signedIn = (headers: Record<string, string> = {}) => GET({
    params: { id: ready.id },
    request: new Request(`http://localhost:4321/api/admin/media/${ready.id}/content`, { headers: { Cookie: cookie, ...headers } }),
  } as unknown as Parameters<typeof GET>[0]);

  // The same origin check as every sibling GET: another origin's page cannot read the bytes, and storage is not asked.
  const beforeOrigin = asked.length;
  const foreignOrigin = await signedIn({ Origin: 'https://evil.example' });
  assert.equal(foreignOrigin.status, 403);
  assert.equal(foreignOrigin.headers.get('cache-control'), 'no-store');
  assert.equal(asked.length, beforeOrigin);
  // A page of this site (no Origin on a same-origin GET, or its own) is answered.
  for (const headers of [{}, { Origin: 'http://localhost:4321' }] as Array<Record<string, string>>) {
    const answered = await signedIn(headers);
    assert.equal(answered.status, 200);
    assert.ok(answered.headers.get('x-request-id'));
    assert.deepEqual(Buffer.from(await answered.arrayBuffer()), pdf);
  }
});
