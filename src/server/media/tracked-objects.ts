import { sql, type Kysely, type RawBuilder } from 'kysely';

import { storedBrandKeys } from '../../lib/site-brand';
import type { Database } from '../db/types';

export interface TrackedObject { ids: string[]; key: string }

/**
 * Every row that points at an object in the media bucket. Reset refuses a bucket holding any other
 * TomeCMS object, and the orphan sweep removes the others, so both read from this one list.
 */
const ROW_SOURCES = [
  { table: 'media_items', id: 'id' },
  // An image's smaller copies are objects of their own, accounted for by the image's id.
  { table: 'media_variants', id: 'media_id' },
  { table: 'media_upload_reservations', id: 'id' },
] as const;
// The site's logos, icon and share image live in the same bucket, and the settings row accounts for them.
const BRAND_COLUMNS = ['brand_logo', 'brand_logo_dark', 'brand_icon', 'brand_share'] as const;
const BRAND_ID = 'site_settings';

function rowQuery(withIds: boolean, keys: readonly string[] | undefined): RawBuilder<{ id?: string; object_key: string }> {
  const among = keys ? sql` where object_key = any(${[...keys]}::text[])` : sql``;
  return sql`${sql.join(ROW_SOURCES.map(({ table, id }) => withIds
    ? sql`select ${sql.ref(id)}::text as id, object_key from ${sql.table(table)}${among}`
    : sql`select object_key from ${sql.table(table)}${among}`), sql` union all `)}`;
}

async function brandKeys(database: Kysely<Database>): Promise<string[]> {
  const rows = await database.selectFrom('site_settings').select([...BRAND_COLUMNS]).execute();
  return rows.flatMap((row) => BRAND_COLUMNS.flatMap((column) => storedBrandKeys(row[column])));
}

/** Every tracked object with the ids of the rows that point at it, sorted by key; given keys, only those among them. */
export async function knownObjects(database: Kysely<Database>, keys?: readonly string[]): Promise<TrackedObject[]> {
  if (keys && !keys.length) return [];
  const wanted = keys ? new Set(keys) : null;
  const { rows } = await rowQuery(true, keys).execute(database);
  const brand = (await brandKeys(database)).filter((key) => !wanted || wanted.has(key)).map((object_key) => ({ id: BRAND_ID, object_key }));
  const objects = new Map<string, string[]>();
  for (const row of [...rows, ...brand]) objects.set(row.object_key, [...objects.get(row.object_key) ?? [], row.id!]);
  return [...objects].map(([key, ids]) => ({ ids, key })).sort((left, right) => left.key.localeCompare(right.key));
}

/** The keys alone, for the sweep: no ids, no order. Given keys, only those among them. */
export async function trackedKeys(database: Kysely<Database>, keys?: readonly string[]): Promise<Set<string>> {
  const tracked = new Set<string>();
  if (keys && !keys.length) return tracked;
  for (const { object_key: key } of (await rowQuery(false, keys).execute(database)).rows) tracked.add(key);
  const wanted = keys ? new Set(keys) : null;
  for (const key of await brandKeys(database)) if (!wanted || wanted.has(key)) tracked.add(key);
  return tracked;
}
