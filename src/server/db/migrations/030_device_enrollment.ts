import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

/**
 * A third kind of enrollment: a one-time link the installed owner creates on a signed-in device
 * to add a passkey on another one. It uses the same table, hash and expiry as install and
 * recovery; only the purpose check has to know the new word.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table installation_enrollments
      drop constraint installation_enrollments_purpose,
      add constraint installation_enrollments_purpose check (purpose in ('install', 'recovery', 'device'));
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`
    delete from installation_enrollments where purpose = 'device';
    alter table installation_enrollments
      drop constraint installation_enrollments_purpose,
      add constraint installation_enrollments_purpose check (purpose in ('install', 'recovery'));
  `.execute(db);
}
