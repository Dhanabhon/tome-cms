import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

import { HeadObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

import { office } from '../helpers/zip';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as const;
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('base64');

test('the store keeps how a document is handed out, and refuses an upload that changes it', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { HttpError } = await import('../../src/server/http/errors');
  const { contentDisposition } = await import('../../src/server/media/disposition');
  const { deleteMedia, finalizeUpload, reserveUpload } = await import('../../src/server/media/service');
  const { s3, s3Bucket } = await import('../../src/server/media/storage');
  const { resolveMediaUrl } = await import('../../src/server/media/url');
  context.after(closeDatabase);

  await migrateToLatest();
  const ownerId = randomUUID();
  await db.insertInto('user').values({
    id: ownerId, name: 'Owner', email: 'stored-files@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();

  const upload = async (originalName: string, mimeType: 'application/pdf' | typeof DOCX, body: Buffer) => {
    const bytes = new Uint8Array(body);
    const reservation = await reserveUpload(ownerId, {
      originalName, mimeType, sizeBytes: body.length, checksumSha256: sha(body), folderId: null, altText: '',
    });
    const headers = reservation.headers as Record<string, string>;
    // The browser asks first, from the site's origin, and may send the header.
    const preflight = await fetch(reservation.uploadUrl, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:4321', 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': Object.keys(headers).join(',') },
    });
    assert.equal(preflight.status, 200);
    assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /content-disposition/i);
    // A changed header, or none, breaks the signature, and the store refuses the upload.
    const changed = { ...headers, 'content-disposition': 'attachment; filename="page.html"' };
    const missing = Object.fromEntries(Object.entries(headers).filter(([name]) => name !== 'content-disposition'));
    for (const sent of [changed, missing]) {
      assert.equal((await fetch(reservation.uploadUrl, { method: 'PUT', headers: sent, body: bytes })).status, 403);
    }
    assert.equal((await fetch(reservation.uploadUrl, { method: 'PUT', headers, body: bytes })).status, 200);
    const item = await finalizeUpload(ownerId, reservation.id);
    const { object_key: key } = await db.selectFrom('media_items').select('object_key').where('id', '=', item.id).executeTakeFirstOrThrow();
    const download = await fetch(resolveMediaUrl(key));
    assert.equal(download.status, 200);
    return { download, item };
  };

  const guide = await upload('คู่มือการสมัคร.pdf', 'application/pdf', Buffer.from('%PDF-1.7\n%%EOF\n'));
  assert.equal(guide.download.headers.get('content-disposition'), contentDisposition('คู่มือการสมัคร.pdf', 'application/pdf'));
  assert.equal(guide.download.headers.get('content-type'), 'application/pdf');
  const plan = await upload('แผนงาน.docx', DOCX, office('word/document.xml'));
  assert.equal(plan.download.headers.get('content-disposition'), contentDisposition('แผนงาน.docx', DOCX));

  // A macro-carrying document is refused against the real store, and nothing of it is left there.
  const macroBody = office('word/document.xml', [{ data: 'x', name: 'word/vbaProject.bin' }]);
  const macroReservation = await reserveUpload(ownerId, {
    originalName: 'macro.docx', mimeType: DOCX, sizeBytes: macroBody.length, checksumSha256: sha(macroBody), folderId: null, altText: '',
  });
  const { object_key: macroKey } = await db.selectFrom('media_upload_reservations').select('object_key')
    .where('id', '=', macroReservation.id).executeTakeFirstOrThrow();
  assert.equal((await fetch(macroReservation.uploadUrl, {
    method: 'PUT', headers: macroReservation.headers as Record<string, string>, body: new Uint8Array(macroBody),
  })).status, 200);
  await assert.rejects(
    finalizeUpload(ownerId, macroReservation.id),
    (error: unknown) => error instanceof HttpError && error.status === 400 && error.details?.code === 'media_macros',
  );
  await assert.rejects(
    s3.send(new HeadObjectCommand({ Bucket: s3Bucket, Key: macroKey })),
    (error: unknown) => (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode === 404,
  );

  // An image signs no Content-Disposition at all; finalize's HEAD check now requires the store to
  // agree there is none, so this has to run against the real store, not a mock.
  const png = await sharp({ create: { width: 2, height: 1, channels: 4, background: '#2a9d8f' } }).png().toBuffer();
  const photoReservation = await reserveUpload(ownerId, {
    originalName: 'photo.png', mimeType: 'image/png', sizeBytes: png.length, checksumSha256: sha(png), folderId: null, altText: 'A cover',
  });
  assert.equal((await fetch(photoReservation.uploadUrl, {
    method: 'PUT', headers: photoReservation.headers as Record<string, string>, body: new Uint8Array(png),
  })).status, 200);
  const photo = await finalizeUpload(ownerId, photoReservation.id);
  assert.deepEqual({ height: photo.height, width: photo.width }, { height: 1, width: 2 });
  const { object_key: photoKey } = await db.selectFrom('media_items').select('object_key')
    .where('id', '=', photo.id).executeTakeFirstOrThrow();
  const photoDownload = await fetch(resolveMediaUrl(photoKey));
  assert.equal(photoDownload.status, 200);
  assert.equal(photoDownload.headers.get('content-type'), 'image/png');
  assert.equal(photoDownload.headers.get('content-disposition'), null);

  await deleteMedia(ownerId, guide.item.id);
  await deleteMedia(ownerId, plan.item.id);
  await deleteMedia(ownerId, photo.id);
});
