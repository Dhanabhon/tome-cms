import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema.alterTable('passkey')
    .addColumn('last_used_at', 'timestamptz')
    .execute();

  await sql`
    create function tomecms_record_passkey_use() returns trigger
    language plpgsql as $$
    begin
      if new.counter is distinct from old.counter then
        new.last_used_at = CURRENT_TIMESTAMP;
      end if;
      return new;
    end;
    $$
  `.execute(db);

  await sql`
    create trigger passkey_record_use
    before update of counter on passkey
    for each row execute function tomecms_record_passkey_use()
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop trigger if exists passkey_record_use on passkey`.execute(db);
  await sql`drop function if exists tomecms_record_passkey_use()`.execute(db);
  await db.schema.alterTable('passkey').dropColumn('last_used_at').execute();
}
