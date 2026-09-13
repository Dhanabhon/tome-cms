import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

export async function up(db: Kysely<Database>): Promise<void> {
  // Sessions created before this migration cannot be proven to belong to a
  // particular Passkey, so fail closed instead of guessing a credential.
  await db.deleteFrom('session').execute();

  await db.schema.alterTable('passkey')
    .addUniqueConstraint('passkey_credential_id_key', ['credentialID'])
    .execute();
  await db.schema.alterTable('session')
    .addColumn('credential_id', 'text', c => c.notNull())
    .execute();
  await db.schema.alterTable('session')
    .addForeignKeyConstraint(
      'session_credential_id_fkey',
      ['credential_id'],
      'passkey',
      ['credentialID'],
      c => c.onDelete('cascade'),
    )
    .execute();

  await sql`
    create function tomecms_guard_session_recovery() returns trigger
    language plpgsql as $$
    declare
      installed_owner_id text;
    begin
      select owner_id into installed_owner_id
      from site_settings
      where id = true
      for update;

      if installed_owner_id = new."userId" and exists (
        select 1
        from installation_enrollments
        where pending_user_id = installed_owner_id
          and purpose = 'recovery'
          and consumed_at is null
          and expires_at > CURRENT_TIMESTAMP
      ) then
        raise exception 'Session creation is blocked during account recovery.'
          using errcode = '23514';
      end if;

      return new;
    end;
    $$
  `.execute(db);
  await sql`
    create trigger session_recovery_guard
    before insert on session
    for each row execute function tomecms_guard_session_recovery()
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop trigger if exists session_recovery_guard on session`.execute(db);
  await sql`drop function if exists tomecms_guard_session_recovery()`.execute(db);
  await db.schema.alterTable('session').dropColumn('credential_id').execute();
  await db.schema.alterTable('passkey').dropConstraint('passkey_credential_id_key').execute();
}
