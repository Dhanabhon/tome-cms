import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { isTomeObjectKey } from '../src/server/media/keys';
import { backupManifestSchema, sha256File, type BackupManifest } from './backup';

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
  });
  if (result.error || result.status !== 0) throw new Error('Disposable restore environment failed.');
  return output ? result.stdout.trim() : '';
}

async function verifyBackup(backup: string): Promise<BackupManifest> {
  const manifest = backupManifestSchema.parse(JSON.parse(await readFile(join(backup, 'manifest.json'), 'utf8')));
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

async function restoreObjects(backup: string, manifest: BackupManifest): Promise<string[]> {
  const storage = new S3Client({
    endpoint: 'http://127.0.0.1:59000',
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'tomecms_test', secretAccessKey: 'foundation-test-only' },
  });
  try {
    for (const object of manifest.objects) {
      await storage.send(new PutObjectCommand({
        Bucket: 'tomecms-test-media',
        Key: object.key,
        Body: createReadStream(join(backup, 'objects', ...object.key.split('/'))),
        ContentLength: object.sizeBytes,
        ContentType: object.contentType,
      }));
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
  return backupManifestSchema.shape.records.parse(JSON.parse(result));
}

async function main(): Promise<void> {
  const options = parseRestoreOptions(process.argv.slice(2));
  const manifest = await verifyBackup(options.backup);
  if (!process.env.MINIO_LICENSE_FILE) throw new Error('MINIO_LICENSE_FILE must name a real external license.');
  const env = { ...process.env, MINIO_LICENSE_FILE: process.env.MINIO_LICENSE_FILE };
  if (compose(options.project, ['ps', '-aq'], env, true)) throw new Error('The disposable Compose project already has containers.');

  let started = false;
  let failure: unknown;
  try {
    started = true;
    compose(options.project, ['up', '-d', '--wait', '--wait-timeout', '90', 'postgres', 'minio'], env);
    compose(options.project, ['run', '--rm', '--no-deps', 'minio-init'], env);
    await restoreDatabase(options.project, options.backup, env);
    const keys = await restoreObjects(options.backup, manifest);
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
