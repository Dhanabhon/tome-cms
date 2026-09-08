import type { Selectable } from 'kysely';

import { db } from '../db/client';
import type { SiteSettingsTable } from '../db/types';

export type SiteSettings = Selectable<SiteSettingsTable>;

export async function getSiteSettings(): Promise<SiteSettings | null> {
  return await db.selectFrom('site_settings')
    .selectAll()
    .where('id', '=', true)
    .executeTakeFirst() ?? null;
}
