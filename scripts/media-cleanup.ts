#!/usr/bin/env node

import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createInterface } from 'node:readline/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Kysely, Transaction } from 'kysely';

import type { Database } from '../src/server/db/types';
import { isTomeObjectKey } from '../src/server/media/keys';

export const CLEANUP_LIMIT = 1_000;

export interface CleanupCandidate {
  id: string;
  kind: 'media' | 'reservation';
  objectKey: string;
}

export function parseCleanupOptions(args: string[]): { execute: boolean } {
  if (!args.length || (args.length === 1 && args[0] === '--dry-run')) return { execute: false };
  if (args.length === 1 && args[0] === '--execute') return { execute: true };
  throw new Error('Usage: npm run media:cleanup [-- --dry-run|--execute]');
}

export function cleanupConfirmation(origin: string, bucket: string): string {
  return `CLEAN ${origin} ${bucket}`;
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

async function resolveStoredCandidate(
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

async function main(): Promise<void> {
  const options = parseCleanupOptions(process.argv.slice(2));
  const [{ db, closeDatabase }, { getServerEnv }, { s3, s3Bucket }] = await Promise.all([
    import('../src/server/db/client'),
    import('../src/server/env'),
    import('../src/server/media/storage'),
  ]);
  try {
    const env = getServerEnv();
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
