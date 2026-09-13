import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema.alterTable('security_rate_limits').dropConstraint('security_rate_limits_action').execute();
  await db.schema.alterTable('security_rate_limits')
    .addCheckConstraint('security_rate_limits_action', sql`action in ('install', 'signin', 'recovery', 'update-check', 'update-apply')`)
    .execute();
}
