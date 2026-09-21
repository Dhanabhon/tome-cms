import { sql, type Selectable } from 'kysely';
import { z } from 'zod';

import { parseStoredIcon, parseStoredImage, type StoredBrandIcon, type StoredBrandImage } from '../../lib/site-brand';
import { isThemeId } from '../../themes/registry';
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
  hideSiteName: z.boolean(),
  showPoweredBy: z.boolean(),
  siteDescription: z.string().trim().max(160),
  siteName: z.string().trim().min(1).max(120),
  tagline: z.string().trim().max(120),
  theme: z.enum(['system', 'light', 'dark']),
  // A theme that no longer ships can still be the stored one; the renderer falls back for
  // it, and the form offers only what is installed, so a write may name only those.
  themeId: z.string().refine(isThemeId, 'Choose an installed theme.'),
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
type ParsedColumns = 'author_links' | 'brand_icon' | 'brand_logo' | 'brand_logo_dark';
export type SiteSettings = Omit<Selectable<SiteSettingsTable>, ParsedColumns> & {
  author_links: AuthorLink[];
  brand_icon: StoredBrandIcon | null;
  brand_logo: StoredBrandImage | null;
  brand_logo_dark: StoredBrandImage | null;
};

function normalizeSettings(row: Selectable<SiteSettingsTable>): SiteSettings {
  return {
    ...row,
    author_links: authorLinksSchema.parse(row.author_links),
    brand_icon: parseStoredIcon(row.brand_icon),
    brand_logo: parseStoredImage(row.brand_logo),
    brand_logo_dark: parseStoredImage(row.brand_logo_dark),
  };
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
      hide_site_name: input.hideSiteName,
      theme_id: input.themeId,
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

export type BrandColumn = 'brand_icon' | 'brand_logo' | 'brand_logo_dark';

/**
 * One brand column set, and what it held before, so the caller can delete what it replaced.
 *
 * Moves updated_at like every write to this row: the public site's Last-Modified is read from
 * it, and a cache must not keep serving the old logo. The Settings form is handed the new
 * version, or its next save would be refused as stale. Not checked against a version itself --
 * a file field applies on the spot and holds no edit the owner is still making.
 */
export async function writeSiteBrand(
  ownerId: string,
  column: BrandColumn,
  value: StoredBrandImage | StoredBrandIcon | null,
): Promise<{ previous: unknown; settings: SiteSettings }> {
  return db.transaction().execute(async (trx) => {
    const current = await trx.selectFrom('site_settings').select(column)
      .where('id', '=', true).where('owner_id', '=', ownerId).forUpdate().executeTakeFirst();
    if (!current) throw new HttpError(404, 'Site settings not found.');
    const stored = value === null ? null : sql<Json>`${JSON.stringify(value)}::jsonb`;
    const row = await trx.updateTable('site_settings')
      .set({ [column]: stored, updated_at: nextVersion })
      .where('id', '=', true).where('owner_id', '=', ownerId)
      .returningAll()
      .executeTakeFirstOrThrow();
    return { previous: current[column], settings: normalizeSettings(row) };
  });
}
