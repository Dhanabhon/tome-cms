import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';

import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

import type { SupportedMediaType } from '../../src/lib/media';
import { office } from '../helpers/zip';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as const;
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('base64');

test('a document is reserved with how it is handed out, judged by its bytes, and kept apart from images', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { createPost } = await import('../../src/server/content/posts');
  const { HttpError } = await import('../../src/server/http/errors');
  const { contentDisposition } = await import('../../src/server/media/disposition');
  const { finalizeUpload, listMedia, mediaListInputSchema, reserveUpload, reserveUploadSchema } = await import('../../src/server/media/service');
  const { s3 } = await import('../../src/server/media/storage');
  context.after(closeDatabase);

  await migrateToLatest();
  const ownerId = randomUUID();
  await db.insertInto('user').values({
    id: ownerId, name: 'Files Owner', email: 'files@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();

  const objects = new Map<string, { body: Buffer; disposition?: string; mimeType: string }>();
  const deleted = new Set<string>();
  const transport = s3 as unknown as { send(command: object): Promise<object> };
  const originalSend = transport.send;
  transport.send = async (command) => {
    const input = (command as { input?: { Key?: string; Range?: string } }).input ?? {};
    const key = input.Key ?? '';
    if (command instanceof DeleteObjectCommand) {
      objects.delete(key);
      deleted.add(key);
      return {};
    }
    const object = objects.get(key);
    if (!object) throw Object.assign(new Error('missing'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
    if (command instanceof HeadObjectCommand) {
      return { ChecksumSHA256: sha(object.body), ContentDisposition: object.disposition, ContentLength: object.body.length, ContentType: object.mimeType };
    }
    if (command instanceof GetObjectCommand) {
      const range = /^bytes=(\d+)-(\d+)$/.exec(input.Range ?? '');
      const body = range ? object.body.subarray(Number(range[1]), Number(range[2]) + 1) : object.body;
      return { Body: Readable.from([body.subarray(0, 5), body.subarray(5)]) };
    }
    throw new Error('Unexpected storage command.');
  };
  context.after(() => { transport.send = originalSend; });

  /** Reserves a file and stores what the browser would put -- or `stored` in its place. */
  const put = async (originalName: string, mimeType: string, body: Buffer, stored: { disposition?: string } = {}) => {
    const reservation = await reserveUpload(ownerId, {
      originalName, mimeType: mimeType as SupportedMediaType, sizeBytes: body.length, checksumSha256: sha(body),
      folderId: null, altText: 'Only an image keeps this',
    });
    const { object_key: key } = await db.selectFrom('media_upload_reservations').select('object_key')
      .where('id', '=', reservation.id).executeTakeFirstOrThrow();
    objects.set(key, { body, disposition: stored.disposition ?? reservation.headers['content-disposition'], mimeType });
    return { key, reservation };
  };
  const refusedAs = (code: string) => (error: unknown) => error instanceof HttpError && error.status === 400 && error.details?.code === code;
  const badRequest = (error: unknown) => error instanceof HttpError && error.status === 400;

  // A PDF is reserved with how it is handed out, signed into the upload.
  const pdf = Buffer.from('%PDF-1.7\n%%EOF\n');
  const guide = await put('คู่มือ.pdf', 'application/pdf', pdf);
  assert.equal(guide.reservation.headers['content-disposition'], contentDisposition('คู่มือ.pdf', 'application/pdf'));
  assert.match(new URL(guide.reservation.uploadUrl).searchParams.get('X-Amz-SignedHeaders') ?? '', /content-disposition/);
  const guideItem = await finalizeUpload(ownerId, guide.reservation.id);
  assert.deepEqual(
    { alt: guideItem.alt_text, height: guideItem.height, type: guideItem.mime_type, width: guideItem.width },
    { alt: null, height: null, type: 'application/pdf', width: null },
  );

  // An Office file is judged by its directory; a macro project is refused, and nothing is kept of it.
  const plan = await put('plan.docx', DOCX, office('word/document.xml'));
  assert.equal((await finalizeUpload(ownerId, plan.reservation.id)).mime_type, DOCX);
  const macro = await put('macro.docx', DOCX, office('word/document.xml', [{ data: 'x', name: 'word/vbaProject.bin' }]));
  await assert.rejects(finalizeUpload(ownerId, macro.reservation.id), refusedAs('media_macros'));
  assert.ok(deleted.has(macro.key), 'its object is deleted');
  assert.equal((await db.selectFrom('media_upload_reservations').select('state')
    .where('id', '=', macro.reservation.id).executeTakeFirstOrThrow()).state, 'expired');

  const thaiCsv = await put('รายชื่อ.csv', 'text/csv', Buffer.from([0xaa, 0xd7, 0xe8, 0xcd, 0x2c, 0x31, 0x0a]));
  await assert.rejects(finalizeUpload(ownerId, thaiCsv.reservation.id), refusedAs('media_text_encoding'));
  const disguised = await put('report.docx', DOCX, pdf);
  await assert.rejects(finalizeUpload(ownerId, disguised.reservation.id), refusedAs('media_type_mismatch'));
  // The store kept a header other than the one signed: what arrived is not what was reserved.
  const swapped = await put('notes.txt', 'text/plain', Buffer.from('notes'), { disposition: 'inline' });
  await assert.rejects(finalizeUpload(ownerId, swapped.reservation.id),
    (error: unknown) => badRequest(error) && /does not match its reservation/.test((error as Error).message));

  // A document is named for what it is, and may be 25 MB where an image may be 8.
  const reserve = (originalName: string, mimeType: string, sizeBytes: number) => reserveUpload(ownerId, {
    originalName, mimeType: mimeType as SupportedMediaType, sizeBytes, checksumSha256: sha(pdf), folderId: null, altText: '',
  });
  await assert.rejects(reserve('guide.docx', 'application/pdf', 100), badRequest, 'a PDF named .docx');
  await assert.rejects(reserve('photo.png', 'image/png', 8_388_609), badRequest, 'an image over 8 MB');
  await reserve('big.zip', 'application/zip', 26_214_400);
  assert.equal(reserveUploadSchema.safeParse({
    originalName: 'big.zip', mimeType: 'application/zip', sizeBytes: 26_214_401, checksumSha256: sha(pdf), folderId: null, altText: '',
  }).success, false);

  // The list filters by type, and an image is still an image.
  const png = await sharp({ create: { width: 2, height: 1, channels: 4, background: '#2a9d8f' } }).png().toBuffer();
  const image = await finalizeUpload(ownerId, (await put('photo.png', 'image/png', png)).reservation.id);
  assert.deepEqual({ height: image.height, width: image.width }, { height: 1, width: 2 });
  const listed = async (type?: string) => (await listMedia(ownerId, mediaListInputSchema.parse({ page: 1, search: '', type })))
    .items.map((entry) => entry.original_name).sort();
  assert.deepEqual(await listed('pdf'), ['คู่มือ.pdf']);
  assert.deepEqual(await listed('document'), ['plan.docx']);
  assert.deepEqual(await listed('file'), ['plan.docx', 'คู่มือ.pdf']);
  assert.deepEqual(await listed('image'), ['photo.png']);
  assert.equal((await listed()).length, 3);
  assert.equal(mediaListInputSchema.safeParse({ type: 'exe' }).success, false);

  // A cover and an article's pictures are images: a document is refused as either.
  await db.insertInto('site_settings').values({
    id: true, owner_id: ownerId, site_name: 'Files', default_locale: 'en', timezone: 'UTC', admin_path: '/admin',
  }).execute();
  const category = await db.insertInto('categories').values({ owner_id: ownerId, name: 'Uncategorized', is_default: true })
    .returning('id').executeTakeFirstOrThrow();
  const post = (coverMediaId: string | null, src?: string) => createPost(ownerId, {
    excerpt: '', categoryIds: [category.id], coverMediaId, metaDescription: null, metaTitle: null,
    slug: `post-${randomUUID()}`, status: 'draft', title: 'Covered',
    contentJson: { type: 'doc', content: src ? [{ type: 'image', attrs: { src } }] : [{ type: 'paragraph' }] },
  });
  await assert.rejects(post(guideItem.id), badRequest, 'a PDF as a cover');
  await assert.rejects(post(null, guideItem.publicUrl), badRequest, 'a PDF as a picture');
  assert.equal((await post(image.id, image.publicUrl)).cover_media_id, image.id, 'an image is still both');
});
