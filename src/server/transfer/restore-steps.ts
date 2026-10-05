import { spawn } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

import {
  DeleteObjectsCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, type S3Client,
} from '@aws-sdk/client-s3';
import { sql } from 'kysely';
import { Client } from 'pg';

import { PLUGIN_MANIFESTS } from '../../plugins/manifests';
import { isDocumentType, type SupportedDocumentType } from '../../lib/media';
import type { BackupManifest, BackupRecordCounts } from '../../update/backup';
import { contentDisposition, dispositionForType } from '../media/disposition';
import { isTomeObjectKey } from '../media/keys';
import { isSealed, openSecret } from '../plugins/secrets';
import { splitDatabaseUrl } from './database-url';
import { countRecords } from './record-counts';

/*
 * The steps a restore runs inside the app image, as one-shots (cli.ts). The database client and
 * the media storage read the environment when they load, so each is imported only by the step
 * that needs it.
 */

/**
 * Every ready document's key, name and type: a backup does not carry `Content-Disposition`
 * (only `contentType` travels with each object), so a restore rebuilds it from the row that
 * survived the database restore, the same header finalize signs into an upload.
 */
export const RESTORED_DOCUMENTS_QUERY = `select coalesce(json_agg(json_build_object('key', object_key, 'name', original_name, 'type', mime_type) order by object_key), '[]'::json)::text from media_items where state = 'ready' and mime_type not like 'image/%'`;

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

/** The dispositions of the documents in the database this process is configured for. */
export async function restoredDocumentDispositions(): Promise<Map<string, string>> {
  const { db } = await import('../db/client');
  const result = await sql.raw<Record<string, string>>(RESTORED_DOCUMENTS_QUERY).execute(db);
  return documentDispositions(JSON.parse(String(Object.values(result.rows[0] ?? {})[0])));
}

/** `pg_restore` of a dump into the database, with the password in PGPASSWORD rather than argv. */
export function pgRestoreInvocation(databaseUrl: string, dumpPath: string): { executable: 'pg_restore'; args: string[]; env: NodeJS.ProcessEnv } {
  const { url, password } = splitDatabaseUrl(databaseUrl);
  const { DATABASE_URL: _databaseUrl, PGPASSWORD: _password, ...env } = process.env;
  return {
    executable: 'pg_restore',
    args: [`--dbname=${url}`, '--no-owner', '--no-privileges', '--exit-on-error', dumpPath],
    env: { ...env, PGPASSWORD: password },
  };
}

async function runPgRestore(args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const child = spawn('pg_restore', args, { env, stdio: ['ignore', 'ignore', 'inherit'] });
  const code = await new Promise<number | null>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', resolveExit);
  });
  if (code !== 0) throw Object.assign(new Error('Database restore failed.'), { code: 'pg_restore_failed' });
}

/**
 * Empties the database, then restores the dump into it. Emptying first matters: a dump from an
 * older version restored beside a newer migration's tables would make the next migration fail on
 * a table that already exists, and `pg_restore --clean` only drops what the dump itself holds.
 */
export async function resetAndRestoreDatabase(databaseUrl: string, dumpPath: string): Promise<void> {
  const invocation = pgRestoreInvocation(databaseUrl, dumpPath);
  // Reads the whole archive's table of contents without a database: a cut-off or foreign file
  // is found out before anything is dropped.
  await runPgRestore(['--list', dumpPath], invocation.env);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('drop schema public cascade; create schema public;');
  } finally {
    await client.end();
  }
  await runPgRestore(invocation.args, invocation.env);
}

function within(directory: string, path: string): boolean {
  const inside = relative(directory, path);
  return inside !== '' && inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside);
}

/**
 * A file a restore reads from a backup: a regular file, reached without a link, inside the real
 * backup directory. A backup copied in with its links, or built by hand, could otherwise hand the
 * one-shot any file it can read, and that file would go up into the media bucket.
 */
export async function backupFile(backup: string, path: string): Promise<string> {
  const candidate = join(backup, path);
  const invalid = () => Object.assign(new Error('The backup holds a file that is not a plain file inside it.'), { code: 'backup_invalid' });
  try {
    if (!(await lstat(candidate)).isFile()) throw invalid();
    const real = await realpath(candidate);
    if (!within(await realpath(backup), real)) throw invalid();
    return real;
  } catch (error) {
    throw (error as { code?: unknown }).code === 'backup_invalid' ? error : invalid();
  }
}

/** Every key in the bucket, sorted. */
export async function listObjectKeys(client: S3Client, bucket: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken }));
    keys.push(...(listed.Contents ?? []).flatMap(({ Key }) => Key ? [Key] : []));
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    if (listed.IsTruncated && !continuationToken) throw new Error('The object listing was incomplete.');
  } while (continuationToken);
  return keys.sort();
}

const DELETE_BATCH = 1000;

/**
 * Makes the bucket equal the backup: every object the manifest lists goes up from
 * `<backup>/objects`, and every TomeCMS object it does not list is deleted. A key TomeCMS never
 * writes is not ours to delete; it is counted as foreign and left.
 */
export async function syncBucketToManifest(
  client: S3Client, bucket: string, backup: string, manifest: BackupManifest, dispositions: Map<string, string>,
): Promise<{ uploaded: number; deleted: number; foreign?: number }> {
  // The key becomes a path under the backup: only the grammar TomeCMS writes may.
  if (!manifest.objects.every(({ key }) => isTomeObjectKey(key))) throw new Error('Backup manifest contains an unsupported object key.');
  // Every file is checked before the first put, so a bad backup changes nothing.
  const paths = new Map<string, string>();
  for (const { key } of manifest.objects) paths.set(key, await backupFile(backup, join('objects', ...key.split('/'))));
  for (const object of manifest.objects) {
    const disposition = dispositions.get(object.key) ?? dispositionForType(object.contentType);
    // Read whole, as the File Manager's puts are: a stream goes up aws-chunked, and SeaweedFS keeps
    // that as the object's Content-Encoding. Each is 25 MiB at most.
    const body = await readFile(paths.get(object.key)!);
    if (body.length !== object.sizeBytes) throw new Error('A backup object does not match the size its manifest gives.');
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: object.key,
      Body: body,
      ContentLength: object.sizeBytes,
      ContentType: object.contentType,
      // A document with no ready row -- an unfinished upload -- goes back with no header, as today.
      ...(disposition ? { ContentDisposition: disposition } : {}),
    }));
  }
  for (const object of manifest.objects) {
    const disposition = dispositions.get(object.key) ?? dispositionForType(object.contentType);
    if (!disposition) continue;
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: object.key }));
    if (head.ContentDisposition !== disposition) throw new Error('Restored document headers do not match the database.');
  }

  const listed = new Set(manifest.objects.map(({ key }) => key));
  const extra = (await listObjectKeys(client, bucket)).filter((key) => !listed.has(key));
  const ours = extra.filter(isTomeObjectKey);
  for (let start = 0; start < ours.length; start += DELETE_BATCH) {
    const batch = ours.slice(start, start + DELETE_BATCH);
    const result = await client.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
    }));
    if (result.Errors?.length) throw new Error('Some objects the backup does not hold could not be deleted.');
  }
  const foreign = extra.length - ours.length;
  return { uploaded: manifest.objects.length, deleted: ours.length, ...(foreign ? { foreign } : {}) };
}

export interface AfterRestoreReport {
  records: BackupRecordCounts;
  /** Plugin secrets stored sealed in the restored database. */
  sealedSecrets: number;
  /** The ones this server's TOME_CMS_CONTEXT_SECRET cannot open: they came from another server. */
  unopenedSecrets: Array<{ plugin: string; setting: string }>;
}

/**
 * Signs everyone out (MCP connections are kept), counts what came back the way a backup counts
 * it, and names every plugin secret this server cannot open.
 */
export async function afterRestoreReport(): Promise<AfterRestoreReport> {
  const { db } = await import('../db/client');
  await db.deleteFrom('session').execute();
  const records = await countRecords(db);
  const rows = await db.selectFrom('plugin_settings').select(['id', 'settings']).orderBy('id').execute();
  let sealedSecrets = 0;
  const unopenedSecrets: AfterRestoreReport['unopenedSecrets'] = [];
  for (const row of rows) {
    const stored = (typeof row.settings === 'object' && row.settings !== null ? row.settings : {}) as Record<string, unknown>;
    const secrets = PLUGIN_MANIFESTS.find(({ id }) => id === row.id)?.settings.filter(({ kind }) => kind === 'secret') ?? [];
    for (const setting of secrets) {
      const value = stored[setting.key];
      if (!isSealed(value)) continue;
      sealedSecrets += 1;
      if (openSecret(value as string) === null) unopenedSecrets.push({ plugin: row.id, setting: setting.key });
    }
  }
  return { records, sealedSecrets, unopenedSecrets };
}
