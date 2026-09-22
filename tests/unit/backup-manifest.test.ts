import assert from 'node:assert/strict';
import test from 'node:test';

import { ACCEPTED_MEDIA_TYPES, MAX_DOCUMENT_FILE_BYTES } from '../../src/lib/media';
import { BRAND_EXTENSIONS, createBrandObjectKey, createObjectKey } from '../../src/server/media/keys';
import { parseBackupManifest } from '../../src/update/backup';

const OWNER = '123e4567-e89b-42d3-a456-426614174000';
const DATE = new Date('2026-09-22T00:00:00Z');
const SHA256 = 'a'.repeat(64);

function objectEntry(key: string, sizeBytes: number) {
  return { key, contentType: 'application/octet-stream', sizeBytes, sha256: SHA256 };
}

function manifest(objects: Array<ReturnType<typeof objectEntry>>) {
  return {
    format: 'tomecms-backup',
    version: 1,
    createdAt: '2026-09-22T00:00:00.000Z',
    applicationVersion: '1.0.0',
    config: {
      publicUrl: 'https://example.invalid',
      database: 'tomecms',
      s3Endpoint: 'https://s3.example.invalid',
      bucket: 'tomecms-media',
    },
    database: { file: 'database.dump', sha256: SHA256 },
    records: { siteSettings: 1, posts: 0, pages: 0, mediaItems: objects.length },
    objects: [...objects].sort((left, right) => left.key.localeCompare(right.key)),
  };
}

test('a backup manifest accepts every key isTomeObjectKey accepts, up to a 25 MB document', () => {
  const mediaObjects = ACCEPTED_MEDIA_TYPES.map((type) => objectEntry(createObjectKey(OWNER, type, DATE), MAX_DOCUMENT_FILE_BYTES));
  const brandObjects = BRAND_EXTENSIONS.map((extension) => objectEntry(createBrandObjectKey(OWNER, extension, DATE), MAX_DOCUMENT_FILE_BYTES));
  const parsed = parseBackupManifest(manifest([...mediaObjects, ...brandObjects]));
  assert.equal(parsed.objects.length, mediaObjects.length + brandObjects.length);
});

test('a backup manifest refuses an object one byte over 25 MB', () => {
  const key = createObjectKey(OWNER, 'application/pdf', DATE);
  assert.throws(() => parseBackupManifest(manifest([objectEntry(key, MAX_DOCUMENT_FILE_BYTES + 1)])), /Invalid backup manifest/);
});
