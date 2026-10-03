import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { finished } from 'node:stream/promises';
import test, { after } from 'node:test';

import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { sql } from 'kysely';

const DATABASE_URL = 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test';
// pg_dump and pg_restore run inside the test stack's own Postgres: a client of another major
// version on the host cannot write or read that server's dumps.
const IN_POSTGRES = ['compose', '-p', 'tomecms-foundation-test', '-f', 'compose.test.yaml', 'exec', '-T', 'postgres'];

after(async () => {
  const { closeDatabase } = await import('../../src/server/db/client');
  await closeDatabase();
});

function assertTestStack(): void {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, DATABASE_URL, 'use only the disposable Foundation database');
}

async function dumpTo(path: string): Promise<void> {
  const output = createWriteStream(path, { flags: 'wx', mode: 0o600 });
  const child = spawn('docker', [
    ...IN_POSTGRES, 'pg_dump', '--host=127.0.0.1', '--username=tomecms_test', '--dbname=tomecms_test',
    '--format=custom', '--no-owner', '--no-privileges',
  ], { stdio: ['ignore', 'pipe', 'inherit'] });
  child.stdout.pipe(output);
  const [code] = await Promise.all([new Promise((resolve) => child.once('close', resolve)), finished(output)]);
  assert.equal(code, 0, 'pg_dump in the test stack');
}

/**
 * A `pg_restore` first on PATH that records how it was called, then runs the real one in the test
 * stack's Postgres with the same flags, reading the dump on stdin.
 */
async function pgRestoreShim(directory: string, log: string): Promise<void> {
  await writeFile(join(directory, 'pg_restore'), `#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const { appendFileSync, openSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, password: process.env.PGPASSWORD ?? null }) + '\\n');
const flags = args.slice(0, -1).filter((arg) => !arg.startsWith('--dbname='));
const target = flags.includes('--list') ? [] : ['--host=127.0.0.1', '--username=tomecms_test', '--dbname=tomecms_test'];
const result = spawnSync('docker', [...${JSON.stringify(IN_POSTGRES)}, 'pg_restore', ...target, ...flags], {
  // Its complaints about the deliberately broken dump go to a file, not the test output.
  cwd: ${JSON.stringify(process.cwd())}, stdio: [openSync(args.at(-1), 'r'), 'inherit', openSync(${JSON.stringify(log)} + '.stderr', 'a')],
});
process.exit(result.status ?? 1);
`, { mode: 0o700 });
}

async function insertPost(slug: string, ownerId: string): Promise<void> {
  const { db } = await import('../../src/server/db/client');
  await db.transaction().execute(async (trx) => {
    const group = randomUUID();
    const category = await trx.insertInto('categories').values({ owner_id: ownerId, name: `Uncategorized ${slug}`, is_default: false })
      .returning('id').executeTakeFirstOrThrow();
    await trx.insertInto('post_translation_groups').values({ id: group, owner_id: ownerId }).execute();
    await trx.insertInto('posts').values({
      translation_group_id: group, locale: 'en', title: slug, slug, content_json: { type: 'doc', content: [] },
      content_html: '', meta_title: null, meta_description: null, status: 'draft', published_at: null, planned_at: null, owner_id: ownerId,
    }).execute();
    await trx.insertInto('post_category_assignments').values({ translation_group_id: group, category_id: category.id, owner_id: ownerId }).execute();
  });
}

test('a dump taken at migration 028 restores into a 029 database, and migrating again finds nothing in its way', async (context) => {
  assertTestStack();
  const { db } = await import('../../src/server/db/client');
  const { migrations, migrateToLatest } = await import('../../src/server/db/migrator');
  const { resetAndRestoreDatabase } = await import('../../src/server/transfer/restore-steps');
  const { Migrator } = await import('kysely/migration');

  const directory = await mkdtemp(join(tmpdir(), 'tomecms-transfer-restore-'));
  const path = process.env.PATH;
  context.after(async () => {
    process.env.PATH = path;
    await rm(directory, { force: true, recursive: true });
  });
  const log = join(directory, 'pg_restore.log');
  await pgRestoreShim(directory, log);
  process.env.PATH = `${directory}${delimiter}${path ?? ''}`;

  const migrator = new Migrator({ db, provider: { async getMigrations() { return migrations; } } });
  assert.ifError((await migrator.migrateTo('028_mcp')).error);
  const ownerId = randomUUID();
  await db.insertInto('user').values({
    id: ownerId, name: 'Owner', email: 'transfer-restore@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: ownerId, site_name: 'Before', default_locale: 'en', timezone: 'UTC', admin_path: '/admin',
  }).execute();
  await insertPost('kept', ownerId);
  const dump = join(directory, 'database.dump');
  await dumpTo(dump);

  await migrateToLatest();
  await insertPost('after-the-backup', ownerId);

  // A dump that is not one is found out before anything is dropped.
  const broken = join(directory, 'broken.dump');
  await writeFile(broken, 'PGDMP, cut off');
  await assert.rejects(resetAndRestoreDatabase(DATABASE_URL, broken), { code: 'pg_restore_failed' });
  assert.equal((await db.selectFrom('posts').select('slug').execute()).length, 2, 'and the database is as it was');

  await resetAndRestoreDatabase(DATABASE_URL, dump);
  await migrateToLatest();

  const posts = await db.selectFrom('posts').select('slug').execute();
  assert.deepEqual(posts, [{ slug: 'kept' }], 'only what the backup held is back');
  const applied = await sql<{ name: string }>`select name from kysely_migration order by name`.execute(db);
  assert.ok(applied.rows.some(({ name }) => name === '029_navigation_parent'), 'and 029 ran over the 028 dump');

  const calls = (await readFile(log, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as { args: string[]; password: string | null });
  assert.deepEqual(calls, [
    { args: ['--list', broken], password: 'foundation-test-only' },
    { args: ['--list', dump], password: 'foundation-test-only' },
    {
      args: ['--dbname=postgresql://tomecms_test@127.0.0.1:55432/tomecms_test', '--no-owner', '--no-privileges', '--exit-on-error', dump],
      password: 'foundation-test-only',
    },
  ], 'the dump is read before the reset, and the password travels in PGPASSWORD, never in argv');
});

test('the bucket ends up holding exactly what the manifest lists, and a document keeps its download name', async (context) => {
  assertTestStack();
  const { s3, s3Bucket } = await import('../../src/server/media/storage');
  const { syncBucketToManifest } = await import('../../src/server/transfer/restore-steps');
  const { contentDisposition } = await import('../../src/server/media/disposition');
  const { createObjectKey } = await import('../../src/server/media/keys');
  context.after(() => s3.destroy());

  const listKeys = async () => {
    const listed = await s3.send(new ListObjectsV2Command({ Bucket: s3Bucket }));
    return (listed.Contents ?? []).flatMap(({ Key }) => Key ? [Key] : []).sort();
  };
  // An empty bucket, whatever an earlier file in the run left in it.
  for (const key of await listKeys()) await s3.send(new DeleteObjectCommand({ Bucket: s3Bucket, Key: key }));

  const owner = randomUUID();
  const a = createObjectKey(owner, 'image/png');
  const b = createObjectKey(owner, 'image/png');
  const c = createObjectKey(owner, 'application/pdf');
  const put = (key: string, body: Buffer, contentType: string) => s3.send(new PutObjectCommand({ Bucket: s3Bucket, Key: key, Body: body, ContentType: contentType }));
  await put(a, Buffer.from('old A'), 'image/png');
  await put(b, Buffer.from('B'), 'image/png');

  const backup = await mkdtemp(join(tmpdir(), 'tomecms-transfer-objects-'));
  context.after(() => rm(backup, { force: true, recursive: true }));
  const files = [
    { key: a, bytes: Buffer.from('new A'), contentType: 'image/png' },
    { key: c, bytes: Buffer.from('%PDF-1.7\n%%EOF\n'), contentType: 'application/pdf' },
  ];
  for (const file of files) {
    const path = join(backup, 'objects', ...file.key.split('/'));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.bytes);
  }
  // Only objects is read, so a manifest of objects alone stands in for the whole.
  const manifest = {
    objects: files.map(({ bytes, contentType, key }) => ({
      key, contentType, sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    })).sort((left, right) => left.key.localeCompare(right.key)),
  } as unknown as Parameters<typeof syncBucketToManifest>[3];
  const disposition = contentDisposition('คู่มือ.pdf', 'application/pdf');

  assert.deepEqual(await syncBucketToManifest(s3, s3Bucket, backup, manifest, new Map([[c, disposition]])), { uploaded: 2, deleted: 1 });
  assert.deepEqual(await listKeys(), [a, c].sort());
  const restoredA = await s3.send(new GetObjectCommand({ Bucket: s3Bucket, Key: a }));
  assert.equal(Buffer.from(await restoredA.Body!.transformToByteArray()).toString(), 'new A', 'the backup\'s bytes, not the old ones');
  const head = await s3.send(new HeadObjectCommand({ Bucket: s3Bucket, Key: c }));
  assert.equal(head.ContentDisposition, disposition, 'the document downloads under its own name');
  assert.equal(head.ContentType, 'application/pdf');

  // A key TomeCMS never writes is someone else's: counted, and left where it is.
  const foreign = 'notes/readme.txt';
  await put(foreign, Buffer.from('not ours'), 'text/plain');
  context.after(() => s3.send(new DeleteObjectCommand({ Bucket: s3Bucket, Key: foreign })));
  assert.deepEqual(await syncBucketToManifest(s3, s3Bucket, backup, manifest, new Map([[c, disposition]])), { uploaded: 2, deleted: 0, foreign: 1 });
  assert.deepEqual(await listKeys(), [a, c, foreign].sort());
});

/** A value sealed the way secrets.ts seals one, but under another server's context secret. */
function sealedElsewhere(value: string): string {
  const key = createHash('sha256').update('another-servers-context-secret').digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}`;
}

test('after a restore everyone is signed out, MCP connections stay, and a secret from another server is named', async () => {
  assertTestStack();
  const { db } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { sealSecret } = await import('../../src/server/plugins/secrets');
  const { afterRestoreReport } = await import('../../src/server/transfer/restore-steps');

  await migrateToLatest();
  const ownerId = randomUUID();
  await db.insertInto('user').values({
    id: ownerId, name: 'Owner', email: 'after-restore@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  await db.insertInto('passkey').values({
    id: 'restored-passkey', name: 'Key', publicKey: 'key', userId: ownerId, credentialID: 'restored-credential', counter: 0,
    deviceType: 'singleDevice', backedUp: false, transports: '', aaguid: null,
  }).execute();
  await db.insertInto('session').values({
    id: 'restored-session', token: 'restored-token', userId: ownerId, credential_id: 'restored-credential',
    expiresAt: new Date(Date.now() + 60_000), updatedAt: new Date(), ipAddress: null, userAgent: null,
  }).execute();
  await db.insertInto('mcp_clients').values({
    id: 'dcr:restored', owner_id: ownerId, kind: 'dcr', name: 'Claude', redirect_uris: sql<string[]>`'[]'::jsonb`,
  }).execute();
  const connection = randomUUID();
  await db.insertInto('mcp_connections').values({
    id: connection, owner_id: ownerId, client_id: 'dcr:restored', client_name: 'Claude', redirect_host: 'claude.ai',
    scopes: ['content:read'], revoked_at: null,
  }).execute();
  await db.insertInto('mcp_tokens').values({
    token_hash: 'a'.repeat(64), connection_id: connection, kind: 'refresh', expires_at: new Date(Date.now() + 60_000),
  }).execute();
  await db.insertInto('plugin_settings').values([
    { id: 'turnstile', owner_id: ownerId, enabled: true, settings: JSON.stringify({ siteKey: 'site', secretKey: sealedElsewhere('theirs') }) },
    { id: 'typesafe', owner_id: ownerId, enabled: false, settings: JSON.stringify({ apiKey: sealSecret('ours') }) },
    { id: 'notice', owner_id: ownerId, enabled: true, settings: JSON.stringify({ text: 'v1.looks-sealed-but-is-text' }) },
  ]).execute();

  const report = await afterRestoreReport();

  assert.equal((await db.selectFrom('session').select('id').execute()).length, 0, 'every session is gone');
  assert.equal((await db.selectFrom('mcp_tokens').select('token_hash').execute()).length, 1, 'an MCP connection keeps working');
  const counted = async (table: 'site_settings' | 'posts' | 'pages' | 'media_items') =>
    Number((await db.selectFrom(table).select((eb) => eb.fn.countAll<string>().as('count')).executeTakeFirstOrThrow()).count);
  assert.deepEqual(report, {
    records: {
      siteSettings: await counted('site_settings'),
      posts: await counted('posts'),
      pages: await counted('pages'),
      mediaItems: await counted('media_items'),
    },
    sealedSecrets: 2,
    unopenedSecrets: [{ plugin: 'turnstile', setting: 'secretKey' }],
  });
});
