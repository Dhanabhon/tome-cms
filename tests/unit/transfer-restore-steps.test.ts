import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { DeleteObjectsCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';

import { createObjectKey } from '../../src/server/media/keys';
import { splitDatabaseUrl } from '../../src/server/transfer/database-url';
import { backupFile, pgRestoreInvocation, syncBucketToManifest } from '../../src/server/transfer/restore-steps';

type Manifest = Parameters<typeof syncBucketToManifest>[3];

test('pg_restore keeps the database password out of argv, as pg_dump does', () => {
  const invocation = pgRestoreInvocation('postgresql://tomecms:secret@postgres:5432/tomecms', '/work/one/database.dump');
  assert.equal(invocation.executable, 'pg_restore');
  assert.deepEqual(invocation.args, [
    '--dbname=postgresql://tomecms@postgres:5432/tomecms', '--no-owner', '--no-privileges', '--exit-on-error', '/work/one/database.dump',
  ]);
  assert.equal(invocation.env.PGPASSWORD, 'secret');
  assert.equal(invocation.env.DATABASE_URL, undefined);
});

test('pg_restore removes query passwords and keeps non-secret options', () => {
  const parentPassword = process.env.PGPASSWORD;
  process.env.PGPASSWORD = 'parent-secret';
  try {
    for (const { databaseUrl, password, secrets, retained } of [
      {
        databaseUrl: 'postgresql://tomecms@postgres:5432/tomecms?sslmode=require&options=-c%20statement_timeout%3D1000&%70assword=query%2Dsecret&application_name=backup',
        password: 'query-secret',
        secrets: ['query-secret', 'parent-secret'],
        retained: ['sslmode=require', 'options=-c%20statement_timeout%3D1000', 'application_name=backup'],
      },
      {
        databaseUrl: 'postgresql://tomecms:userinfo-secret@postgres:5432/tomecms?password=query-secret',
        password: 'query-secret',
        secrets: ['userinfo-secret', 'query-secret', 'parent-secret'],
        retained: [],
      },
      {
        databaseUrl: 'postgresql://tomecms@postgres:5432/tomecms?password=first-secret&password=last-secret&sslmode=require',
        password: 'last-secret',
        secrets: ['first-secret', 'last-secret', 'parent-secret'],
        retained: ['sslmode=require'],
      },
      {
        databaseUrl: 'postgresql://tomecms:userinfo-secret@postgres:5432/tomecms?password=',
        password: 'userinfo-secret',
        secrets: ['userinfo-secret', 'parent-secret'],
        retained: [],
      },
      {
        databaseUrl: 'postgresql://tomecms:userinfo-secret@postgres:5432/tomecms?password=first-secret&password=&sslmode=require',
        password: 'userinfo-secret',
        secrets: ['userinfo-secret', 'first-secret', 'parent-secret'],
        retained: ['sslmode=require'],
      },
    ]) {
      const invocation = pgRestoreInvocation(databaseUrl, '/work/one/database.dump');
      const args = invocation.args.join(' ');
      assert.equal(invocation.env.PGPASSWORD, password);
      for (const secret of secrets) assert.ok(!args.includes(secret));
      for (const option of retained) assert.ok(args.includes(option));
    }
  } finally {
    if (parentPassword === undefined) delete process.env.PGPASSWORD;
    else process.env.PGPASSWORD = parentPassword;
  }
});

test('the options only the app\'s own pool understands never reach libpq, which refuses them', () => {
  assert.deepEqual(
    splitDatabaseUrl('postgresql://tomecms:secret@postgres:5432/tomecms?query_timeout=5&sslmode=require&statement_timeout=5&connectionTimeoutMillis=5'),
    { url: 'postgresql://tomecms@postgres:5432/tomecms?sslmode=require', password: 'secret' },
  );
});

/** A bucket that answers listings from `pages` and records every other call. */
function fakeBucket(pages: string[][], deleteErrors = false) {
  const calls: unknown[] = [];
  const client = {
    async send(command: unknown) {
      if (command instanceof ListObjectsV2Command) {
        const page = Number(command.input.ContinuationToken ?? 0);
        return {
          Contents: pages[page]!.map((Key) => ({ Key })),
          IsTruncated: page + 1 < pages.length,
          NextContinuationToken: page + 1 < pages.length ? String(page + 1) : undefined,
        };
      }
      calls.push(command);
      if (command instanceof DeleteObjectsCommand) return deleteErrors ? { Errors: [{ Key: 'x', Code: 'AccessDenied' }] } : {};
      return {};
    },
  } as unknown as S3Client;
  return { calls, client };
}

test('the delete pass reads every page, then deletes in batches of 1000, and stops on an error', async () => {
  const owner = randomUUID();
  const keys = Array.from({ length: 1500 }, () => createObjectKey(owner, 'image/png'));
  const { calls, client } = fakeBucket([keys.slice(0, 700), [...keys.slice(700), 'notes/readme.txt']]);
  const empty = { objects: [] } as unknown as Manifest;
  assert.deepEqual(await syncBucketToManifest(client, 'bucket', '/nowhere', empty, new Map()), { uploaded: 0, deleted: 1500, foreign: 1 });
  assert.deepEqual(calls.map((call) => (call as DeleteObjectsCommand).input.Delete!.Objects!.length), [1000, 500]);

  const failing = fakeBucket([keys.slice(0, 3)], true);
  await assert.rejects(syncBucketToManifest(failing.client, 'bucket', '/nowhere', empty, new Map()), /could not be deleted/);
});

test('a backup file must be a regular file inside the backup, never a link out of it', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'tomecms-transfer-links-'));
  context.after(() => rm(root, { force: true, recursive: true }));
  const backup = join(root, 'backup');
  const outside = join(root, 'outside');
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, 'secret'), 'not part of any backup');

  const owner = randomUUID();
  const linked = createObjectKey(owner, 'image/png');
  const otherOwner = randomUUID();
  const throughLinkedDirectory = createObjectKey(otherOwner, 'image/png');
  const directory = createObjectKey(owner, 'image/png');
  const objectPath = (key: string) => join(backup, 'objects', ...key.split('/'));
  await mkdir(dirname(objectPath(linked)), { recursive: true });
  await symlink(join(outside, 'secret'), objectPath(linked));
  await mkdir(objectPath(directory), { recursive: true });
  // A directory on the way to the object that leads out of the backup.
  const [, , year] = throughLinkedDirectory.split('/');
  await mkdir(join(outside, 'month'), { recursive: true });
  await writeFile(join(outside, 'month', throughLinkedDirectory.split('/').at(-1)!), 'outside');
  await mkdir(join(backup, 'objects', 'owners', otherOwner, year!), { recursive: true });
  await symlink(join(outside, 'month'), dirname(objectPath(throughLinkedDirectory)));
  await symlink(join(outside, 'secret'), join(backup, 'manifest.json'));

  for (const key of [linked, throughLinkedDirectory, directory]) {
    const { calls, client } = fakeBucket([[]]);
    const manifest = { objects: [{ key, contentType: 'image/png', sizeBytes: 1, sha256: '0'.repeat(64) }] } as unknown as Manifest;
    await assert.rejects(syncBucketToManifest(client, 'bucket', backup, manifest, new Map()), { code: 'backup_invalid' }, key);
    assert.equal(calls.length, 0, 'refused before anything was put');
  }
  await assert.rejects(backupFile(backup, 'manifest.json'), { code: 'backup_invalid' }, 'a linked manifest');
  await writeFile(join(backup, 'kept.json'), '{}');
  assert.ok((await backupFile(backup, 'kept.json')).endsWith('kept.json'), 'a plain file inside is accepted');
});

test('a restored SVG goes back as a download, as the brand settings stored it', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'tomecms-transfer-svg-'));
  context.after(() => rm(root, { force: true, recursive: true }));
  const owner = randomUUID();
  const svg = createObjectKey(owner, 'image/png').replace(/\.png$/, '.svg');
  const png = createObjectKey(owner, 'image/png');
  for (const key of [svg, png]) {
    await mkdir(dirname(join(root, 'objects', ...key.split('/'))), { recursive: true });
    await writeFile(join(root, 'objects', ...key.split('/')), 'x');
  }
  const puts = new Map<string, string | undefined>();
  const client = {
    async send(command: unknown) {
      if (command instanceof ListObjectsV2Command) return { Contents: [], IsTruncated: false };
      if (command instanceof PutObjectCommand) puts.set(command.input.Key!, command.input.ContentDisposition);
      if (command instanceof HeadObjectCommand) return { ContentDisposition: puts.get(command.input.Key!) };
      return {};
    },
  } as unknown as S3Client;
  const manifest = { objects: [
    { key: svg, contentType: 'image/svg+xml', sizeBytes: 1, sha256: '0'.repeat(64) },
    { key: png, contentType: 'image/png', sizeBytes: 1, sha256: '0'.repeat(64) },
  ] } as unknown as Manifest;
  await syncBucketToManifest(client, 'bucket', root, manifest, new Map());
  assert.equal(puts.get(svg), 'attachment');
  assert.equal(puts.get(png), undefined);
});
