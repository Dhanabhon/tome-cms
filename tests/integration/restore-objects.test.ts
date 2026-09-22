import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';

test('a restore puts back how each document is handed out, and an image as it was', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  const { restoreObjects } = await import('../../scripts/restore-check');
  const { contentDisposition } = await import('../../src/server/media/disposition');
  const { createObjectKey } = await import('../../src/server/media/keys');

  // A backup's objects directory, holding one document and one image.
  const backup = await mkdtemp(join(tmpdir(), 'tomecms-restore-objects-'));
  context.after(() => rm(backup, { force: true, recursive: true }));
  const owner = randomUUID();
  const files = [
    { bytes: Buffer.from('%PDF-1.7\n%%EOF\n'), contentType: 'application/pdf', key: createObjectKey(owner, 'application/pdf') },
    { bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]), contentType: 'image/png', key: createObjectKey(owner, 'image/png') },
  ];
  for (const file of files) {
    const path = join(backup, 'objects', ...file.key.split('/'));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.bytes);
  }
  const objects = files.map(({ bytes, contentType, key }) => ({
    contentType, key, sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length,
  }));
  const [pdf, png] = files;
  const disposition = contentDisposition('คู่มือ.pdf', 'application/pdf');

  // Only objects is read, so a manifest of objects alone stands in for the whole.
  const keys = await restoreObjects(backup, { objects } as unknown as Parameters<typeof restoreObjects>[1], new Map([[pdf!.key, disposition]]));
  assert.ok(keys.includes(pdf!.key) && keys.includes(png!.key), 'both objects are back in the bucket');

  const storage = new S3Client({
    credentials: { accessKeyId: 'tomecms_test', secretAccessKey: 'foundation-test-only' },
    endpoint: 'http://127.0.0.1:59000',
    forcePathStyle: true,
    region: 'us-east-1',
  });
  context.after(() => storage.destroy());
  const head = (key: string) => storage.send(new HeadObjectCommand({ Bucket: 'tomecms-test-media', Key: key }));
  assert.equal((await head(pdf!.key)).ContentDisposition, disposition, 'the document downloads under its own name again');
  assert.equal((await head(png!.key)).ContentDisposition, undefined, 'an image is handed out as it always was');
});
