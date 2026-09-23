import { sql, type Selectable } from 'kysely';

import { parseMaintenanceCopy, type MaintenanceMutation, type MaintenanceSettings } from '../../lib/site-maintenance';
import type { HomeSlideMedia, Json } from '../../types/cms';
import { db } from '../db/client';
import type { SiteSettingsTable } from '../db/types';
import { HttpError } from '../http/errors';
import { assertReadyMediaReferences } from '../media/service';
import { stableMediaPath } from '../media/url';

/**
 * The owner's maintenance page and switch. Named apart from src/server/update/maintenance.ts,
 * which is the updater's and has nothing to do with this.
 *
 * Neither write moves site_settings.updated_at. That column is the Settings form's version and
 * the public Last-Modified; closing the site changes neither the settings nor the content, and
 * moving it would refuse the next save of a Settings form open in another tab.
 */

const COLUMNS = ['maintenance_back_at', 'maintenance_copy', 'maintenance_enabled', 'maintenance_media_id', 'maintenance_template'] as const;
type MaintenanceColumns = Pick<Selectable<SiteSettingsTable>, (typeof COLUMNS)[number]>;

function settingsOf(row: MaintenanceColumns): MaintenanceSettings {
  return {
    backAt: row.maintenance_back_at?.toISOString() ?? null,
    copy: parseMaintenanceCopy(row.maintenance_copy),
    enabled: row.maintenance_enabled,
    mediaId: row.maintenance_media_id,
    template: row.maintenance_template,
  };
}

function postgresCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null;
}

export async function readMaintenance(ownerId: string): Promise<{ maintenance: MaintenanceSettings; media: HomeSlideMedia | null }> {
  const row = await db.selectFrom('site_settings').select(COLUMNS)
    .where('id', '=', true).where('owner_id', '=', ownerId).executeTakeFirst();
  if (!row) throw new HttpError(404, 'Site settings not found.');
  const picture = row.maintenance_media_id
    ? await db.selectFrom('media_items').select(['id', 'alt_text', 'width', 'height', 'size_bytes'])
      .where('id', '=', row.maintenance_media_id).where('owner_id', '=', ownerId).executeTakeFirst()
    : undefined;
  return {
    maintenance: settingsOf(row),
    media: picture?.width && picture.height
      ? { ...picture, height: picture.height, publicUrl: stableMediaPath(picture.id), size_bytes: Number(picture.size_bytes), width: picture.width }
      : null,
  };
}

export async function saveMaintenance(ownerId: string, input: MaintenanceMutation): Promise<MaintenanceSettings> {
  try {
    await assertReadyMediaReferences(db, ownerId, input.mediaId ? [input.mediaId] : []);
    const row = await db.updateTable('site_settings')
      .set({
        maintenance_back_at: input.backAt,
        maintenance_copy: sql<Json>`${JSON.stringify(input.copy)}::jsonb`,
        maintenance_media_id: input.mediaId,
        maintenance_template: input.template,
      })
      .where('id', '=', true).where('owner_id', '=', ownerId)
      .returning(COLUMNS)
      .executeTakeFirst();
    if (!row) throw new HttpError(404, 'Site settings not found.');
    return settingsOf(row);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (['22P02', '23503', '23514'].includes(postgresCode(error) ?? '')) throw new HttpError(400, 'Invalid maintenance page.');
    throw error;
  }
}

export async function setMaintenanceState(ownerId: string, enabled: boolean): Promise<MaintenanceSettings> {
  const row = await db.updateTable('site_settings').set({ maintenance_enabled: enabled })
    .where('id', '=', true).where('owner_id', '=', ownerId)
    .returning(COLUMNS)
    .executeTakeFirst();
  if (!row) throw new HttpError(404, 'Site settings not found.');
  return settingsOf(row);
}
