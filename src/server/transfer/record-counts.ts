import { sql, type Kysely } from 'kysely';

import type { BackupRecordCounts } from '../../update/backup';
import type { Database } from '../db/types';

/**
 * What a backup records in its manifest, and what a restore compares against it. Shared by
 * scripts/backup.ts, which runs from source in the image, so it imports types alone besides kysely.
 */
export async function countRecords(db: Kysely<Database>): Promise<BackupRecordCounts> {
  const result = await sql<BackupRecordCounts>`
    select
      (select count(*)::integer from site_settings) as "siteSettings",
      (select count(*)::integer from posts) as posts,
      (select count(*)::integer from pages) as pages,
      (select count(*)::integer from media_items) as "mediaItems"
  `.execute(db);
  return result.rows[0]!;
}
