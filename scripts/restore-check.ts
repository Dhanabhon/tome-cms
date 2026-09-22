import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { isDocumentType, type SupportedDocumentType } from '../src/lib/media';
import { contentDisposition } from '../src/server/media/disposition';
import { isTomeObjectKey } from '../src/server/media/keys';
import { parseBackupManifest, parseBackupRecordCounts, type BackupManifest } from '../src/update/backup';
import { sha256File } from './backup';

/**
 * Every ready document's key, name and type: a backup does not carry `Content-Disposition`
 * (only `contentType` travels with each object), so restore-check rebuilds it from the row that
 * survived the database restore, the same header finalize signs into an upload.
 */
export const RESTORED_DOCUMENTS_QUERY = `select coalesce(json_agg(json_build_object('key', object_key, 'name', original_name, 'type', mime_type) order by object_key), '[]'::json)::text from media_items where state = 'ready' and mime_type not like 'image/%'`;

const repository = fileURLToPath(new URL('..', import.meta.url));
const projectPattern = /^tomecms-restore-check-[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function parseRestoreOptions(args: string[]): { backup: string; project: string } {
  let backup = '';
  let project = '';
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--backup' && args[index + 1]) backup = args[++index]!;
    else if (args[index] === '--project' && args[index + 1]) project = args[++index]!;
    else throw new Error('Usage: npm run restore:check -- --backup /absolute/backup --project tomecms-restore-check-unique');
  }
  if (!isAbsolute(backup) || !projectPattern.test(project)) {
    throw new Error('Use an absolute backup path and a unique tomecms-restore-check-* project name.');
  }
  return { backup: resolve(backup), project };
}

function compose(project: string, args: string[], env: NodeJS.ProcessEnv, output = false): string {
  const result = spawnSync('docker', ['compose', '-p', project, '-f', 'compose.test.yaml', ...args], {
    cwd: repository,
    env,
    encoding: 'utf8',
    stdio: output ? ['ignore', 'pipe', 'ignore'] : 'ignore',
    // A library may hold 100,000 items; spawnSync's own default (1 MiB) is too small for that.
    ...(output ? { maxBuffer: 256 * 1024 * 1024 } : {}),
  });
  if (result.error || result.status !== 0) throw new Error('Disposable restore environment failed.');
  return output ? result.stdout.trim() : '';
}

function documentRow(value: unknown): { key: string; name: string; type: SupportedDocumentType } {
  if (typeof value !== 'object' || value === null) throw new Error('Restored media rows are invalid.');
  const { key, name, type } = value as Record<string, unknown>;
  if (typeof key !== 'string' || !isTomeObjectKey(key) || typeof name !== 'string' || !name ||
    typeof type !== 'string' || !isDocumentType(type)) {
    throw new Error('Restored media rows are invalid.');
  }
  return { key, name, type };
}

/** Each ready document's key mapped to the `Content-Disposition` a restore has to put back. */
export function documentDispositions(rows: unknown): Map<string, string> {
  if (!Array.isArray(rows)) throw new Error('Restored media rows are invalid.');
  return new Map<string, string>(rows.map(documentRow).map((row) => [row.key, contentDisposition(row.name, row.type)]));
}

async function verifyBackup(backup: string): Promise<BackupManifest> {
  const manifest = parseBackupManifest(JSON.parse(await readFile(join(backup, 'manifest.json'), 'utf8')));
  const databaseFile = join(backup, manifest.database.file);
  if (await sha256File(databaseFile) !== manifest.database.sha256) throw new Error('Database dump checksum does not match its manifest.');
  for (const object of manifest.objects) {
    if (!isTomeObjectKey(object.key)) throw new Error('Backup manifest contains an unsupported object key.');
    const path = join(backup, 'objects', ...object.key.split('/'));
    if (await sha256File(path) !== object.sha256) throw new Error(`Media checksum failed for ${object.key}.`);
  }
  return manifest;
}

async function restoreDatabase(project: string, backup: string, env: NodeJS.ProcessEnv): Promise<void> {
  const child = spawn('docker', [
    'compose', '-p', project, '-f', 'compose.test.yaml', 'exec', '-T', 'postgres',
    'pg_restore', '--host=127.0.0.1', '--username=tomecms_test', '--dbname=tomecms_test',
    '--clean', '--if-exists', '--no-owner', '--no-privileges',
  ], { cwd: repository, env, stdio: ['pipe', 'ignore', 'ignore'] });
  try {
    const [code] = await Promise.all([
      new Promise<number | null>((resolveExit, reject) => {
        child.once('error', reject);
        child.once('close', resolveExit);
      }),
      pipeline(createReadStream(join(backup, 'database.dump')), child.stdin),
    ]);
    if (code !== 0) throw new Error('Database restore failed.');
  } catch {
    child.kill();
    throw new Error('Database restore failed.');
  }
}

export async function restoreObjects(backup: string, manifest: BackupManifest, dispositions: Map<string, string>): Promise<string[]> {
  const storage = new S3Client({
    endpoint: 'http://127.0.0.1:59000',
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'tomecms_test', secretAccessKey: 'foundation-test-only' },
  });
  try {
    for (const object of manifest.objects) {
      const disposition = dispositions.get(object.key);
      await storage.send(new PutObjectCommand({
        Bucket: 'tomecms-test-media',
        Key: object.key,
        Body: createReadStream(join(backup, 'objects', ...object.key.split('/'))),
        ContentLength: object.sizeBytes,
        ContentType: object.contentType,
        // A document with no ready row -- an unfinished upload -- goes back with no header, as today.
        ...(disposition ? { ContentDisposition: disposition } : {}),
      }));
    }
    for (const object of manifest.objects) {
      const disposition = dispositions.get(object.key);
      if (!disposition) continue;
      const head = await storage.send(new HeadObjectCommand({ Bucket: 'tomecms-test-media', Key: object.key }));
      if (head.ContentDisposition !== disposition) throw new Error('Restored document headers do not match the database.');
    }
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const listed = await storage.send(new ListObjectsV2Command({
        Bucket: 'tomecms-test-media',
        ContinuationToken: continuationToken,
      }));
      keys.push(...(listed.Contents ?? []).flatMap(({ Key }) => Key ? [Key] : []));
      continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
      if (listed.IsTruncated && !continuationToken) throw new Error('Restored object listing was incomplete.');
    } while (continuationToken);
    return keys.sort();
  } finally {
    storage.destroy();
  }
}

function restoredDocumentDispositions(project: string, env: NodeJS.ProcessEnv): Map<string, string> {
  const result = compose(project, [
    'exec', '-T', 'postgres', 'psql', '--host=127.0.0.1', '--username=tomecms_test',
    '--dbname=tomecms_test', '--tuples-only', '--no-align', '--command', RESTORED_DOCUMENTS_QUERY,
  ], env, true);
  return documentDispositions(JSON.parse(result));
}

function restoredCounts(project: string, env: NodeJS.ProcessEnv): BackupManifest['records'] {
  const query = `select json_build_object(
    'siteSettings', (select count(*) from site_settings),
    'posts', (select count(*) from posts),
    'pages', (select count(*) from pages),
    'mediaItems', (select count(*) from media_items)
  )::text`;
  const result = compose(project, [
    'exec', '-T', 'postgres', 'psql', '--host=127.0.0.1', '--username=tomecms_test',
    '--dbname=tomecms_test', '--tuples-only', '--no-align', '--command', query,
  ], env, true);
  return parseBackupRecordCounts(JSON.parse(result));
}

async function main(): Promise<void> {
  const options = parseRestoreOptions(process.argv.slice(2));
  const manifest = await verifyBackup(options.backup);
  const env = process.env;
  if (compose(options.project, ['ps', '-aq'], env, true)) throw new Error('The disposable Compose project already has containers.');

  let started = false;
  let failure: unknown;
  try {
    started = true;
    compose(options.project, ['up', '-d', '--wait', '--wait-timeout', '90', 'postgres', 'seaweedfs'], env);
    await restoreDatabase(options.project, options.backup, env);
    const dispositions = restoredDocumentDispositions(options.project, env);
    const keys = await restoreObjects(options.backup, manifest, dispositions);
    compose(options.project, ['exec', '-T', 'postgres', 'pg_isready', '--username=tomecms_test', '--dbname=tomecms_test'], env);
    const counts = restoredCounts(options.project, env);
    if (JSON.stringify(counts) !== JSON.stringify(manifest.records)) throw new Error('Restored database counts do not match the backup.');
    const expectedKeys = manifest.objects.map(({ key }) => key).sort();
    if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) throw new Error('Restored object inventory does not match the backup.');
    console.log(`Restore verified in disposable project ${options.project}.`);
  } catch (error) {
    failure = error;
  } finally {
    if (started) {
      try {
        compose(options.project, ['down', '--volumes', '--remove-orphans'], env);
      } catch (error) {
        if (!failure) failure = error;
        else console.error('Warning: disposable restore cleanup also failed.');
      }
    }
  }
  if (failure) throw failure;
}

function selfTest(): void {
  const parsed = parseRestoreOptions(['--project', 'tomecms-restore-check-example', '--backup', '/var/backups/tomecms-one']);
  if (parsed.project !== 'tomecms-restore-check-example') throw new Error('Restore option self-check failed.');
  let rejected = false;
  try { parseRestoreOptions(['--project', 'tomecms', '--backup', '/']); } catch { rejected = true; }
  if (!rejected) throw new Error('Unsafe restore project was accepted.');
  console.log('Restore-check self-test passed.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === '--self-test') selfTest();
  else main().catch((error: unknown) => {
    console.error(`Error: ${error instanceof Error ? error.message : 'Restore verification failed.'}`);
    process.exitCode = 1;
  });
}
