import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { finished } from 'node:stream/promises';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { sql } from 'kysely';
import { z } from 'zod';

import { isTomeObjectKey } from '../src/server/media/keys';
import type { ServerEnv } from '../src/server/env';

const repository = fileURLToPath(new URL('..', import.meta.url));
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const count = z.number().int().nonnegative();

export const backupManifestSchema = z.object({
  format: z.literal('tomecms-backup'),
  version: z.literal(1),
  createdAt: z.iso.datetime({ offset: true }),
  applicationVersion: z.string().min(1),
  config: z.object({
    publicUrl: z.url(),
    database: z.string().min(1),
    s3Endpoint: z.url(),
    bucket: z.string().min(1),
  }).strict(),
  database: z.object({ file: z.literal('database.dump'), sha256 }).strict(),
  records: z.object({ siteSettings: count, posts: count, pages: count, mediaItems: count }).strict(),
  objects: z.array(z.object({
    key: z.string().min(1),
    contentType: z.string().min(1),
    sizeBytes: count,
    sha256,
  }).strict()),
}).strict();

export type BackupManifest = z.infer<typeof backupManifestSchema>;

export function safeBackupRoot(input: string, root = repository): string {
  if (!isAbsolute(input)) throw new Error('Backup output must be an absolute path outside the repository.');
  const output = resolve(input);
  if (output === parse(output).root) throw new Error('Backup output cannot be a filesystem root.');
  const within = relative(resolve(root), output);
  if (within === '' || (!within.startsWith(`..${sep}`) && !isAbsolute(within))) {
    throw new Error('Backup output must be outside the repository.');
  }
  return output;
}

export interface BackupOptions {
  offline: true;
  direct: boolean;
  json: boolean;
  outputRoot: string;
}

export function parseBackupOptions(args: string[]): BackupOptions {
  let offline = false;
  let direct = false;
  let json = false;
  let outputRoot = '';
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--offline') offline = true;
    else if (args[index] === '--direct') direct = true;
    else if (args[index] === '--json') json = true;
    else if (args[index] === '--output-root' && args[index + 1]) outputRoot = args[++index]!;
    else throw new Error('Usage: npm run backup -- --offline [--direct] [--json] --output-root /absolute/backup/path');
  }
  if (!offline || !outputRoot) throw new Error('Usage: npm run backup -- --offline [--direct] [--json] --output-root /absolute/backup/path');
  return { offline: true, direct, json, outputRoot: safeBackupRoot(outputRoot) };
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function composeOutput(args: string[]): string {
  const result = spawnSync('docker', ['compose', '-f', 'compose.yaml', '--env-file', '.env.local', ...args], {
    cwd: repository,
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) throw new Error('Docker Compose backup preflight failed.');
  return result.stdout.trim();
}

async function dumpDatabase(destination: string): Promise<void> {
  const output = createWriteStream(destination, { flags: 'wx', mode: 0o600 });
  const child = spawn('docker', [
    'compose', '-f', 'compose.yaml', '--env-file', '.env.local', 'exec', '-T', 'postgres',
    'pg_dump', '--host=127.0.0.1', '--username=tomecms', '--dbname=tomecms',
    '--format=custom', '--no-owner', '--no-privileges',
  ], { cwd: repository, stdio: ['ignore', 'pipe', 'ignore'] });
  child.stdout.pipe(output);
  const [code] = await Promise.all([
    new Promise<number | null>((resolveExit, reject) => {
      child.once('error', reject);
      child.once('close', resolveExit);
    }),
    finished(output),
  ]);
  if (code !== 0) throw new Error('Database dump failed.');
}

export interface PgDumpInvocation {
  executable: 'pg_dump';
  args: string[];
  env: NodeJS.ProcessEnv;
}

export function directPgDumpInvocation(databaseUrl: string): PgDumpInvocation {
  const url = new URL(databaseUrl);
  const password = decodeURIComponent(url.password);
  url.password = '';
  const { DATABASE_URL: _databaseUrl, PGPASSWORD: _password, ...env } = process.env;
  return {
    executable: 'pg_dump',
    args: [`--dbname=${url}`, '--format=custom', '--no-owner', '--no-privileges'],
    env: { ...env, PGPASSWORD: password },
  };
}

async function dumpDatabaseDirect(destination: string, databaseUrl: string): Promise<void> {
  const output = createWriteStream(destination, { flags: 'wx', mode: 0o600 });
  const invocation = directPgDumpInvocation(databaseUrl);
  const child = spawn(invocation.executable, invocation.args, {
    cwd: repository,
    env: invocation.env,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  child.stdout.pipe(output);
  const [code] = await Promise.all([
    new Promise<number | null>((resolveExit, reject) => {
      child.once('error', reject);
      child.once('close', resolveExit);
    }),
    finished(output),
  ]);
  if (code !== 0) throw new Error('Database dump failed.');
}

async function recordCounts(): Promise<BackupManifest['records']> {
  const { db, closeDatabase } = await import('../src/server/db/client');
  try {
    const result = await sql<BackupManifest['records']>`
      select
        (select count(*)::integer from site_settings) as "siteSettings",
        (select count(*)::integer from posts) as posts,
        (select count(*)::integer from pages) as pages,
        (select count(*)::integer from media_items) as "mediaItems"
    `.execute(db);
    return result.rows[0]!;
  } finally {
    await closeDatabase();
  }
}

async function mirrorObjects(destination: string): Promise<BackupManifest['objects']> {
  const { s3, s3Bucket } = await import('../src/server/media/storage');
  const objects: BackupManifest['objects'] = [];
  let continuationToken: string | undefined;
  try {
    do {
      const listed = await s3.send(new ListObjectsV2Command({ Bucket: s3Bucket, ContinuationToken: continuationToken }));
      for (const item of listed.Contents ?? []) {
        if (!item.Key || !isTomeObjectKey(item.Key)) throw new Error('The media bucket contains an unsupported object key.');
        const object = await s3.send(new GetObjectCommand({ Bucket: s3Bucket, Key: item.Key }));
        const bytes = await object.Body?.transformToByteArray();
        if (!bytes) throw new Error('A media object could not be read.');
        const path = join(destination, ...item.Key.split('/'));
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
        objects.push({
          key: item.Key,
          contentType: object.ContentType || 'application/octet-stream',
          sizeBytes: bytes.byteLength,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
      }
      continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
      if (listed.IsTruncated && !continuationToken) throw new Error('The media object listing was incomplete.');
    } while (continuationToken);
  } finally {
    s3.destroy();
  }
  return objects.sort((left, right) => left.key.localeCompare(right.key));
}

async function main(): Promise<void> {
  const options = parseBackupOptions(process.argv.slice(2));
  const { outputRoot } = options;
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const verifiedRoot = safeBackupRoot(await realpath(outputRoot), await realpath(repository));
  if (!options.direct && composeOutput(['ps', '-q', 'app'])) throw new Error('Stop the Compose application before taking an offline backup.');

  const createdAt = new Date();
  const destination = join(verifiedRoot, `tomecms-${createdAt.toISOString().replace(/[-:.]/g, '')}`);
  await mkdir(destination, { mode: 0o700 });
  const databaseFile = join(destination, 'database.dump');
  let env: ServerEnv | undefined;
  if (options.direct) {
    const { getServerEnv } = await import('../src/server/env');
    env = getServerEnv();
    await dumpDatabaseDirect(databaseFile, env.DATABASE_URL);
  } else {
    await dumpDatabase(databaseFile);
  }
  const [records, objects] = await Promise.all([
    recordCounts(),
    mirrorObjects(join(destination, 'objects')),
  ]);
  const [packageJson] = await Promise.all([
    readFile(join(repository, 'package.json'), 'utf8').then((value) => z.object({ version: z.string() }).parse(JSON.parse(value))),
  ]);
  if (!env) {
    const { getServerEnv } = await import('../src/server/env');
    env = getServerEnv();
  }
  const database = decodeURIComponent(new URL(env.DATABASE_URL).pathname.slice(1));
  const manifest = backupManifestSchema.parse({
    format: 'tomecms-backup',
    version: 1,
    createdAt: createdAt.toISOString(),
    applicationVersion: packageJson.version,
    config: {
      publicUrl: env.TOME_CMS_PUBLIC_URL,
      database,
      s3Endpoint: env.S3_ENDPOINT,
      bucket: env.S3_BUCKET,
    },
    database: { file: 'database.dump', sha256: await sha256File(databaseFile) },
    records,
    objects,
  });
  const manifestPath = join(destination, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  if (options.json) {
    console.log(JSON.stringify({ backupDirectory: destination, manifestSha256: await sha256File(manifestPath) }));
  } else {
    console.log(`Backup complete: ${destination}`);
    console.log(`Database records: ${records.posts + records.pages}; media objects: ${objects.length}`);
  }
}

function selfTest(): void {
  const output = safeBackupRoot('/var/backups/tomecms', '/srv/tomecms');
  if (output !== '/var/backups/tomecms') throw new Error('Backup path self-check failed.');
  let rejected = false;
  try { safeBackupRoot('/srv/tomecms/backups', '/srv/tomecms'); } catch { rejected = true; }
  if (!rejected) throw new Error('Unsafe backup path was accepted.');
  if (!parseBackupOptions(['--offline', '--output-root', '/var/backups/tomecms']).offline) throw new Error('Option self-check failed.');
  console.log('Backup self-check passed.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === '--self-test') selfTest();
  else main().catch((error: unknown) => {
    console.error(`Error: ${error instanceof Error ? error.message : 'Backup failed.'}`);
    process.exitCode = 1;
  });
}
