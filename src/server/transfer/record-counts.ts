import { sql, type Kysely } from 'kysely';

import type { BackupRecordCounts } from '../../update/backup';
import type { Database } from '../db/types';

// PostgreSQL's undefined_table.
const MISSING_TABLE = '42P01';

/**
 * What a backup records in its manifest, and what a restore compares against it. Shared by
 * scripts/backup.ts, which runs from source in the image, so it imports types alone besides kysely.
 * A table that is not there holds no records: a restore that failed half-way can leave the schema
 * empty or half made, and the safety backup of the next restore must still be taken of it.
 */
export async function countRecords(db: Kysely<Database>): Promise<BackupRecordCounts> {
  return {
    siteSettings: await countRows(db, 'site_settings'),
    posts: await countRows(db, 'posts'),
    pages: await countRows(db, 'pages'),
    mediaItems: await countRows(db, 'media_items'),
  };
}

async function countRows(db: Kysely<Database>, table: 'site_settings' | 'posts' | 'pages' | 'media_items'): Promise<number> {
  try {
    const result = await sql<{ count: number }>`select count(*)::integer as count from ${sql.table(table)}`.execute(db);
    return result.rows[0]!.count;
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === MISSING_TABLE) return 0;
    throw error;
  }
}
