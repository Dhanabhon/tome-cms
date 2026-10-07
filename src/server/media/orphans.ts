import { DeleteObjectsCommand, ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3';
import type { Kysely } from 'kysely';

import type { Database } from '../db/types';
import { isTomeObjectKey } from './keys';
import { knownObjects } from './tracked-objects';

/** Only objects at least this old are swept, so an upload still in flight is never touched. */
export const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;
/** How many keys a report names; past them it only counts. */
export const ORPHAN_KEYS_SHOWN = 50;
const DELETE_BATCH = 1_000;

export interface OrphanReport {
  /** Objects nothing points at, and their bytes. */
  count: number;
  bytes: number;
  /** The first of them, in bucket order. */
  keys: string[];
  deleted: number;
  failed: number;
  /** Ones a row came to point at between the listing and the delete, so they stayed. */
  kept: number;
}

/** An object in TomeCMS's key grammar, that no row points at, and a day old or more. */
export function isOrphan(object: { Key?: string; LastModified?: Date }, tracked: ReadonlySet<string>, now: Date): boolean {
  return Boolean(object.Key && isTomeObjectKey(object.Key) && !tracked.has(object.Key) &&
    object.LastModified && now.getTime() - object.LastModified.getTime() >= ORPHAN_MIN_AGE_MS);
}

/**
 * Finds the objects nothing points at, one listing page at a time, and with `execute` deletes
 * them page by page. A failed delete is counted and the sweep goes on.
 */
export async function sweepOrphans(input: {
  storage: S3Client;
  bucket: string;
  database: Kysely<Database>;
  execute: boolean;
  now?: Date;
  pageSize?: number;
}): Promise<OrphanReport> {
  const now = input.now ?? new Date();
  const tracked = new Set((await knownObjects(input.database)).map(({ key }) => key));
  const report: OrphanReport = { count: 0, bytes: 0, keys: [], deleted: 0, failed: 0, kept: 0 };
  let token: string | undefined;
  do {
    const page = await input.storage.send(new ListObjectsV2Command({ Bucket: input.bucket, ContinuationToken: token, MaxKeys: input.pageSize }));
    const found = (page.Contents ?? []).filter((object) => isOrphan(object, tracked, now));
    for (const object of found) {
      report.count += 1;
      report.bytes += object.Size ?? 0;
      if (report.keys.length < ORPHAN_KEYS_SHOWN) report.keys.push(object.Key!);
    }
    if (input.execute) await remove(input, found.map(({ Key }) => Key!), report);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
    if (page.IsTruncated && !token) throw new Error('The media bucket could not be listed in full.');
  } while (token);
  return report;
}

async function remove(input: { storage: S3Client; bucket: string; database: Kysely<Database> }, keys: string[], report: OrphanReport): Promise<void> {
  for (let start = 0; start < keys.length; start += DELETE_BATCH) {
    const batch = keys.slice(start, start + DELETE_BATCH);
    // Asked again just before deleting: a row may have come to point at one since the listing.
    const now = new Set((await knownObjects(input.database, batch)).map(({ key }) => key));
    const going = batch.filter((key) => !now.has(key));
    report.kept += batch.length - going.length;
    if (!going.length) continue;
    try {
      const result = await input.storage.send(new DeleteObjectsCommand({
        Bucket: input.bucket,
        Delete: { Objects: going.map((Key) => ({ Key })), Quiet: true },
      }));
      const errors = result.Errors?.length ?? 0;
      report.failed += errors;
      report.deleted += going.length - errors;
    } catch {
      report.failed += going.length;
    }
  }
}
