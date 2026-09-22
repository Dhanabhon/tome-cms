const sha256Pattern = /^[0-9a-f]{64}$/;
const createdAtPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
/**
 * Its own copy of the grammar `isTomeObjectKey` accepts (src/server/media/keys.ts): the updater's
 * build is self-contained, so it must accept every key `isTomeObjectKey` accepts, and
 * tests/unit/backup-manifest.test.ts holds the two together.
 */
const objectKeyPattern = /^owners\/([0-9a-f-]{36})\/(\d{4})\/(0[1-9]|1[0-2])\/([0-9a-f-]{36})\.(avif|csv|docx|gif|jpg|pdf|png|pptx|svg|txt|webp|xlsx|zip)$/i;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maximumObjects = 100_000;
const maximumObjectBytes = 25 * 1024 * 1024;

export interface BackupRecordCounts {
  siteSettings: number;
  posts: number;
  pages: number;
  mediaItems: number;
}

export interface BackupManifest {
  format: 'tomecms-backup';
  version: 1;
  createdAt: string;
  applicationVersion: string;
  config: {
    publicUrl: string;
    database: string;
    s3Endpoint: string;
    bucket: string;
  };
  database: { file: 'database.dump'; sha256: string };
  records: BackupRecordCounts;
  objects: Array<{
    key: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
  }>;
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw new Error('Invalid backup manifest');
  return value as Record<string, unknown>;
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function url(value: unknown): value is string {
  if (!nonempty(value)) return false;
  try { new URL(value); return true; } catch { return false; }
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function objectKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = objectKeyPattern.exec(value);
  return Boolean(match && uuidPattern.test(match[1] ?? '') && uuidPattern.test(match[4] ?? ''));
}

export function parseBackupRecordCounts(value: unknown): BackupRecordCounts {
  const input = record(value, ['siteSettings', 'posts', 'pages', 'mediaItems']);
  if (!count(input.siteSettings) || !count(input.posts) || !count(input.pages) || !count(input.mediaItems)) {
    throw new Error('Invalid backup manifest');
  }
  return {
    siteSettings: input.siteSettings,
    posts: input.posts,
    pages: input.pages,
    mediaItems: input.mediaItems,
  };
}

export function parseBackupManifest(value: unknown): BackupManifest {
  const input = record(value, [
    'format', 'version', 'createdAt', 'applicationVersion', 'config', 'database', 'records', 'objects',
  ]);
  const config = record(input.config, ['publicUrl', 'database', 's3Endpoint', 'bucket']);
  const database = record(input.database, ['file', 'sha256']);
  if (input.format !== 'tomecms-backup' || input.version !== 1 || !nonempty(input.applicationVersion) ||
    typeof input.createdAt !== 'string' || !createdAtPattern.test(input.createdAt) ||
    !Number.isFinite(Date.parse(input.createdAt)) || !url(config.publicUrl) || !nonempty(config.database) ||
    !url(config.s3Endpoint) || !nonempty(config.bucket) || database.file !== 'database.dump' ||
    typeof database.sha256 !== 'string' || !sha256Pattern.test(database.sha256) ||
    !Array.isArray(input.objects) || input.objects.length > maximumObjects) throw new Error('Invalid backup manifest');

  const objects = input.objects.map((value) => {
    const item = record(value, ['key', 'contentType', 'sizeBytes', 'sha256']);
    if (!objectKey(item.key) || !nonempty(item.contentType) || !count(item.sizeBytes) ||
      item.sizeBytes > maximumObjectBytes || typeof item.sha256 !== 'string' || !sha256Pattern.test(item.sha256)) {
      throw new Error('Invalid backup manifest');
    }
    return { key: item.key, contentType: item.contentType, sizeBytes: item.sizeBytes, sha256: item.sha256 };
  });
  if (objects.some((item, index) => index > 0 && objects[index - 1]!.key.localeCompare(item.key) >= 0)) {
    throw new Error('Invalid backup manifest');
  }

  return {
    format: 'tomecms-backup', version: 1, createdAt: input.createdAt,
    applicationVersion: input.applicationVersion,
    config: {
      publicUrl: config.publicUrl,
      database: config.database,
      s3Endpoint: config.s3Endpoint,
      bucket: config.bucket,
    },
    database: { file: 'database.dump', sha256: database.sha256 },
    records: parseBackupRecordCounts(input.records),
    objects,
  };
}
