import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

const TIMESTAMPS = `
  new.updated_at = case
    when tg_op = 'INSERT' then date_trunc('milliseconds', clock_timestamp())
    else greatest(
      date_trunc('milliseconds', clock_timestamp()),
      date_trunc('milliseconds', old.updated_at) + interval '1 millisecond'
    )
  end;
`;

/**
 * A date the owner chose is a date the database keeps.
 *
 * The trigger owned `published_at` outright: publishing stamped the moment it happened and
 * every later save carried that stamp forward, which is right for "published now" and
 * leaves no way to say "published on Friday". Whatever the write supplies is kept now, and
 * the stamp is what a write that supplies nothing still gets -- so publishing without
 * naming a date behaves exactly as it did.
 *
 * A draft still has no date at all. It has not been published, and a draft holding the
 * date it was going to be published on is a draft that lies to every query that asks.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create or replace function tomecms_set_content_timestamps() returns trigger
    language plpgsql as $$
    begin
      ${sql.raw(TIMESTAMPS)}
      if new.status = 'draft' then
        new.published_at = null;
      elsif tg_op = 'INSERT' or old.status is distinct from 'published' then
        new.published_at = coalesce(new.published_at, current_timestamp);
      else
        new.published_at = coalesce(new.published_at, old.published_at);
      end if;
      return new;
    end;
    $$;
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`
    create or replace function tomecms_set_content_timestamps() returns trigger
    language plpgsql as $$
    begin
      ${sql.raw(TIMESTAMPS)}
      if new.status = 'draft' then
        new.published_at = null;
      elsif tg_op = 'INSERT' or old.status is distinct from 'published' then
        new.published_at = current_timestamp;
      else
        new.published_at = old.published_at;
      end if;
      return new;
    end;
    $$;
  `.execute(db);
}
