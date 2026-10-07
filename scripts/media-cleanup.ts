#!/usr/bin/env node

import { DeleteObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { createInterface } from 'node:readline/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Kysely, Transaction } from 'kysely';

import { formatBytes } from '../src/cli/output.js';
import type { Database } from '../src/server/db/types';
import { isTomeObjectKey } from '../src/server/media/keys';
import type { OrphanReport } from '../src/server/media/orphans';

export const CLEANUP_LIMIT = 1_000;

export interface CleanupCandidate {
  id: string;
  kind: 'media' | 'reservation';
  objectKey: string;
}

export function parseCleanupOptions(args: string[]): { execute: boolean; orphans: boolean } {
  const orphans = args.includes('--orphans');
  const rest = args.filter((arg) => arg !== '--orphans');
  if (args.length - rest.length <= 1) {
    if (!rest.length || (rest.length === 1 && rest[0] === '--dry-run')) return { execute: false, orphans };
    if (rest.length === 1 && rest[0] === '--execute') return { execute: true, orphans };
  }
  throw new Error('Usage: npm run media:cleanup [-- [--orphans] --dry-run|--execute]');
}

/** What the orphan sweep found, and what it did with them. */
export function orphanReportLines(report: OrphanReport, execute: boolean): string[] {
  if (!report.count) return ['No media files are left in storage with nothing pointing at them.'];
  const lines = [
    `${report.count} media file${report.count === 1 ? ' in storage is' : 's in storage are'} over a day old and nothing points at ${report.count === 1 ? 'it' : 'them'} (${formatBytes(report.bytes)}):`,
    ...report.keys.map((key) => `  ${key}`),
  ];
  if (report.count > report.keys.length) lines.push(`  and ${report.count - report.keys.length} more`);
  if (!execute) return [...lines, 'Dry run complete. No changes were made. Delete them with: npm run media:cleanup -- --orphans --execute'];
  lines.push(`Deleted: ${report.deleted}; failed: ${report.failed}.`);
  if (report.kept) lines.push(`${report.kept} came into use while the sweep ran, so ${report.kept === 1 ? 'it was' : 'they were'} kept.`);
  return lines;
}

export function cleanupConfirmation(origin: string, bucket: string): string {
  return `CLEAN ${origin} ${bucket}`;
}

/** A database by its host and name, never its password: the bucket's other user would be another one. */
export function databaseLabel(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  return `${url.host}/${decodeURIComponent(url.pathname.slice(1))}`;
}

export function orphanConfirmation(origin: string, database: string, bucket: string): string {
  return `SWEEP ${origin} ${database} ${bucket}`;
}

export async function runCleanupCandidates(
  candidates: CleanupCandidate[],
  resolveCandidate: (candidate: CleanupCandidate) => Promise<boolean>,
): Promise<{ failed: CleanupCandidate[]; resolved: CleanupCandidate[]; skipped: CleanupCandidate[] }> {
  const result = { failed: [] as CleanupCandidate[], resolved: [] as CleanupCandidate[], skipped: [] as CleanupCandidate[] };
  for (const candidate of candidates.slice(0, CLEANUP_LIMIT)) {
    try {
      (await resolveCandidate(candidate) ? result.resolved : result.skipped).push(candidate);
    } catch {
      result.failed.push(candidate);
    }
  }
  return result;
}

async function candidates(database: Kysely<Database>): Promise<CleanupCandidate[]> {
  const reservations = await database.selectFrom('media_upload_reservations')
    .select(['id', 'object_key'])
    .where((expression) => expression.or([
      expression('state', '=', 'expired'),
      expression.and([expression('state', '=', 'pending'), expression('expires_at', '<=', new Date())]),
    ]))
    .orderBy('expires_at').orderBy('id').limit(CLEANUP_LIMIT).execute();
  const remaining = CLEANUP_LIMIT - reservations.length;
  const media = remaining
    ? await database.selectFrom('media_items').select(['id', 'object_key'])
      .where('state', '=', 'delete_failed').orderBy('updated_at').orderBy('id').limit(remaining).execute()
    : [];
  return [
    ...reservations.map((row) => ({ id: row.id, kind: 'reservation' as const, objectKey: row.object_key })),
    ...media.map((row) => ({ id: row.id, kind: 'media' as const, objectKey: row.object_key })),
  ];
}

export async function resolveStoredCandidate(
  database: Kysely<Database>,
  candidate: CleanupCandidate,
  removeObject: (key: string) => Promise<void>,
): Promise<boolean> {
  return database.transaction().execute(async (transaction: Transaction<Database>) => {
    if (candidate.kind === 'reservation') {
      const row = await transaction.selectFrom('media_upload_reservations').select(['object_key', 'state', 'expires_at'])
        .where('id', '=', candidate.id).forUpdate().executeTakeFirst();
      if (!row || (row.state === 'pending' && row.expires_at.getTime() > Date.now()) || row.state === 'finalized') return false;
      if (row.object_key !== candidate.objectKey || !isTomeObjectKey(row.object_key)) throw new Error('Unsafe reservation object key.');
      await removeObject(row.object_key);
      await transaction.deleteFrom('media_upload_reservations').where('id', '=', candidate.id)
        .where('state', 'in', ['pending', 'expired']).executeTakeFirstOrThrow();
      return true;
    }

    const row = await transaction.selectFrom('media_items').select(['object_key', 'state'])
      .where('id', '=', candidate.id).forUpdate().executeTakeFirst();
    if (!row || row.state !== 'delete_failed') return false;
    if (row.object_key !== candidate.objectKey || !isTomeObjectKey(row.object_key)) throw new Error('Unsafe media object key.');
    // An image's smaller copies go with it; their rows go with its row.
    const variants = await transaction.selectFrom('media_variants').select('object_key').where('media_id', '=', candidate.id).execute();
    if (!variants.every(({ object_key: key }) => isTomeObjectKey(key))) throw new Error('Unsafe media object key.');
    for (const { object_key: key } of variants) await removeObject(key);
    await removeObject(row.object_key);
    await transaction.deleteFrom('media_items').where('id', '=', candidate.id)
      .where('state', '=', 'delete_failed').executeTakeFirstOrThrow();
    return true;
  });
}

async function ask(question: string): Promise<string> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await prompt.question(question);
  } finally {
    prompt.close();
  }
}

/**
 * The orphan sweep from a checkout: always a dry run first, then, with --execute, a typed line that
 * names the site, the database and the bucket. Two sites sharing one bucket see each other's files
 * as untracked, which is why the line names the database too.
 */
async function sweep(execute: boolean, origin: string, database: string, input: {
  db: Kysely<Database>; s3: S3Client; s3Bucket: string;
}): Promise<void> {
  const { sweepOrphans } = await import('../src/server/media/orphans');
  console.log('TomeCMS orphan sweep');
  console.log(`Site: ${origin}`);
  console.log(`Database: ${database}`);
  console.log(`Bucket: ${input.s3Bucket}`);
  const found = await sweepOrphans({ storage: input.s3, bucket: input.s3Bucket, database: input.db, execute: false });
  const listing = orphanReportLines(found, false);
  // With --execute, the dry run's closing line ("Dry run complete… Delete them with…") would mislead.
  for (const line of execute && found.count ? listing.slice(0, -1) : listing) console.log(line);
  if (!execute || !found.count) return;
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run this command in an interactive terminal.');
  console.log('If another TomeCMS site uses this bucket, these may be its files: stop here and give each site its own bucket.');
  const expected = orphanConfirmation(origin, database, input.s3Bucket);
  console.log('Type this line to delete them, or press Enter to cancel:');
  console.log(`  ${expected}`);
  if ((await ask('> ')).trim() !== expected) {
    console.log('Cancelled. No changes were made.');
    return;
  }
  const report = await sweepOrphans({ storage: input.s3, bucket: input.s3Bucket, database: input.db, execute: true });
  for (const line of orphanReportLines(report, true)) console.log(line);
  if (report.failed) throw new Error('Some media files could not be deleted. Run the sweep again after storage recovers.');
}

async function main(): Promise<void> {
  const options = parseCleanupOptions(process.argv.slice(2));
  const [{ db, closeDatabase }, { getServerEnv }, { s3, s3Bucket }] = await Promise.all([
    import('../src/server/db/client'),
    import('../src/server/env'),
    import('../src/server/media/storage'),
  ]);
  try {
    const env = getServerEnv();
    if (options.orphans) {
      await sweep(options.execute, new URL(env.TOME_CMS_PUBLIC_URL).origin, databaseLabel(env.DATABASE_URL), { db, s3, s3Bucket });
      return;
    }
    const queued = await candidates(db);
    const origin = new URL(env.TOME_CMS_PUBLIC_URL).origin;
    console.log('TomeCMS media cleanup preview');
    console.log(`Site: ${origin}`);
    console.log(`Bucket: ${s3Bucket}`);
    console.log(`Candidates: ${queued.length}`);
    for (const candidate of queued) console.log(`${candidate.kind}: ${candidate.id}`);
    if (!options.execute || !queued.length) {
      console.log(options.execute ? 'Nothing to clean.' : 'Dry run complete. No changes were made.');
      return;
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run this command in an interactive terminal.');
    const expected = cleanupConfirmation(origin, s3Bucket);
    if (await ask(`Type "${expected}" to continue: `) !== expected) {
      console.log('Cancelled. No changes were made.');
      return;
    }
    const result = await runCleanupCandidates(queued, (candidate) => resolveStoredCandidate(
      db,
      candidate,
      async (key) => { await s3.send(new DeleteObjectCommand({ Bucket: s3Bucket, Key: key })); },
    ));
    console.log(`Resolved: ${result.resolved.length}; skipped: ${result.skipped.length}; failed: ${result.failed.length}`);
    for (const candidate of result.failed) console.error(`Failed ${candidate.kind}: ${candidate.id}`);
    if (result.failed.length) throw new Error('Some media operations remain unresolved. Run cleanup again after storage recovers.');
  } finally {
    s3.destroy();
    await closeDatabase();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Media cleanup failed.');
    process.exitCode = 1;
  });
}
