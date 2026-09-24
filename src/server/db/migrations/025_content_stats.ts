import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

/**
 * The Stats screen's counters: one row a day for each combination of what a hit is broken down
 * by, and two numbers on it.
 *
 * Nothing here says who read anything. A hit adds one to its row with an upsert on the key, which
 * is atomic however many arrive at once. The key treats null as a value (`nulls not distinct`),
 * so the home page, which has no id, is one row a day like any article; it begins with
 * (owner_id, day), which makes it the index every read of the screen uses.
 *
 * `content_id` is not a foreign key. A deleted article keeps its history, and the screen lists
 * it as deleted.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table content_stats_daily (
      owner_id text not null references "user"(id) on delete cascade,
      day date not null,
      kind text not null,
      content_id uuid,
      locale text not null,
      referrer text not null default '',
      device text not null,
      country text not null default '',
      views integer not null default 0,
      reads integer not null default 0,
      constraint content_stats_daily_key
        unique nulls not distinct (owner_id, day, kind, content_id, locale, referrer, device, country),
      constraint content_stats_daily_kind_check check (kind in ('home', 'post', 'page')),
      constraint content_stats_daily_content_check check ((kind = 'home') = (content_id is null)),
      constraint content_stats_daily_locale_check check (locale in ('th', 'en')),
      constraint content_stats_daily_device_check check (device in ('mobile', 'desktop')),
      constraint content_stats_daily_country_check check (country = '' or country ~ '^[A-Z]{2}$'),
      constraint content_stats_daily_referrer_check check (char_length(referrer) <= 253),
      constraint content_stats_daily_counts_check check (views >= 0 and reads >= 0)
    )
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop table content_stats_daily`.execute(db);
}
