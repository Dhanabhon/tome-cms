import { sql, type Selectable } from 'kysely';
import { z } from 'zod';

import type { AuthorLink, Json } from '../../types/cms';
import { db } from '../db/client';
import type { SiteSettingsTable } from '../db/types';
import { HttpError } from '../http/errors';
import { assertReadyMediaReferences } from '../media/service';
import { invalidatePublicNavigationCache } from './navigation';

const httpUrl = z.string().trim().pipe(z.url({ protocol: /^https?$/, error: 'Use an HTTP or HTTPS URL.' }));
const authorLinksSchema = z.array(z.object({
  label: z.string().trim().min(1).max(80),
  url: httpUrl,
}).strict()).max(5);

export const siteSettingsMutationSchema = z.object({
  allowVisitorTheme: z.boolean(),
  defaultLocale: z.enum(['th', 'en']),
  showPoweredBy: z.boolean(),
  siteDescription: z.string().trim().max(160),
  siteName: z.string().trim().min(1).max(120),
  tagline: z.string().trim().max(120),
  theme: z.enum(['system', 'light', 'dark']),
  timezone: z.enum(['Asia/Bangkok', 'UTC']),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict();

export const profileMutationSchema = z.object({
  authorAvatarMediaId: z.uuid().nullable(),
  authorBioEn: z.string().trim().max(1000),
  authorBioTh: z.string().trim().max(1000),
  authorLinks: authorLinksSchema,
  authorName: z.string().trim().max(120),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict();

export type SiteSettingsMutation = z.infer<typeof siteSettingsMutationSchema>;
export type ProfileMutation = z.infer<typeof profileMutationSchema>;
export type SiteSettings = Omit<Selectable<SiteSettingsTable>, 'author_links'> & { author_links: AuthorLink[] };

function normalizeSettings(row: Selectable<SiteSettingsTable>): SiteSettings {
  return { ...row, author_links: authorLinksSchema.parse(row.author_links) };
}

async function missingOrStale(ownerId: string): Promise<never> {
  const exists = await db.selectFrom('site_settings')
    .select('id')
    .where('id', '=', true)
    .where('owner_id', '=', ownerId)
    .executeTakeFirst();
  if (!exists) throw new HttpError(404, 'Site settings not found.');
  throw new HttpError(409, 'These settings changed elsewhere. Reload the page and try again.');
}

const nextVersion = sql<Date>`greatest(
  date_trunc('milliseconds', clock_timestamp()),
  date_trunc('milliseconds', updated_at) + interval '1 millisecond'
)`;

function versionMatches(updatedAt: string) {
  return sql<boolean>`date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${updatedAt}::timestamptz)`;
}

export async function getSiteSettings(): Promise<SiteSettings | null> {
  const row = await db.selectFrom('site_settings')
    .selectAll()
    .where('id', '=', true)
    .executeTakeFirst();
  return row ? normalizeSettings(row) : null;
}

export async function getOwnerSettings(ownerId: string): Promise<SiteSettings | null> {
  const row = await db.selectFrom('site_settings')
    .selectAll()
    .where('id', '=', true)
    .where('owner_id', '=', ownerId)
    .executeTakeFirst();
  return row ? normalizeSettings(row) : null;
}

export async function updateSiteSettings(ownerId: string, input: SiteSettingsMutation): Promise<SiteSettings> {
  const row = await db.updateTable('site_settings')
    .set({
      default_locale: input.defaultLocale,
      site_description: input.siteDescription,
      site_name: input.siteName,
      tagline: input.tagline,
      theme: input.theme,
      allow_visitor_theme: input.allowVisitorTheme,
      show_powered_by: input.showPoweredBy,
      timezone: input.timezone,
      updated_at: nextVersion,
    })
    .where('id', '=', true)
    .where('owner_id', '=', ownerId)
    .where(versionMatches(input.updatedAt))
    .returningAll()
    .executeTakeFirst();
  if (!row) return missingOrStale(ownerId);
  invalidatePublicNavigationCache();
  return normalizeSettings(row);
}

export async function updateOwnerProfile(ownerId: string, input: ProfileMutation): Promise<SiteSettings> {
  await assertReadyMediaReferences(db, ownerId, input.authorAvatarMediaId ? [input.authorAvatarMediaId] : []);
  const row = await db.updateTable('site_settings')
    .set({
      author_name: input.authorName,
      author_avatar_media_id: input.authorAvatarMediaId,
      author_bio_th: input.authorBioTh,
      author_bio_en: input.authorBioEn,
      author_links: sql<Json>`${JSON.stringify(input.authorLinks)}::jsonb`,
      updated_at: nextVersion,
    })
    .where('id', '=', true)
    .where('owner_id', '=', ownerId)
    .where(versionMatches(input.updatedAt))
    .returningAll()
    .executeTakeFirst();
  return row ? normalizeSettings(row) : missingOrStale(ownerId);
}
