import type { Kysely } from 'kysely';

import { storedBrandKeys } from '../../lib/site-brand';
import type { Database } from '../db/types';

export interface TrackedObject { ids: string[]; key: string }

/**
 * Every object in the media bucket that a row accounts for, with the ids of the rows; given keys,
 * only those among them. Reset refuses a bucket holding any other TomeCMS object, and the orphan
 * sweep removes the others, so both read this one list.
 */
export async function knownObjects(database: Kysely<Database>, keys?: readonly string[]): Promise<TrackedObject[]> {
  if (keys && !keys.length) return [];
  const among = keys ? [...keys] : [];
  const media = await database.selectFrom('media_items').select(['id', 'object_key'])
    .$if(keys !== undefined, (query) => query.where('object_key', 'in', among)).execute();
  const reservations = await database.selectFrom('media_upload_reservations').select(['id', 'object_key'])
    .$if(keys !== undefined, (query) => query.where('object_key', 'in', among)).execute();
  // An image's smaller copies are objects of their own, accounted for by the image's id.
  const variants = await database.selectFrom('media_variants').select(['media_id as id', 'object_key'])
    .$if(keys !== undefined, (query) => query.where('object_key', 'in', among)).execute();
  // The site's logos, icon and share image live in the same bucket, and the settings row accounts for them.
  const wanted = keys ? new Set(keys) : null;
  const brand = (await database.selectFrom('site_settings').select(['brand_logo', 'brand_logo_dark', 'brand_icon', 'brand_share']).execute())
    .flatMap((row) => [row.brand_logo, row.brand_logo_dark, row.brand_icon, row.brand_share].flatMap(storedBrandKeys))
    .filter((key) => !wanted || wanted.has(key))
    .map((object_key) => ({ id: 'site_settings', object_key }));
  const objects = new Map<string, string[]>();
  for (const row of [...media, ...variants, ...reservations, ...brand]) {
    objects.set(row.object_key, [...objects.get(row.object_key) ?? [], row.id]);
  }
  return [...objects].map(([key, ids]) => ({ ids, key })).sort((left, right) => left.key.localeCompare(right.key));
}
