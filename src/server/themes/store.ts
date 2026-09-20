import { sql } from 'kysely';

import { db } from '../db/client';
import { HttpError } from '../http/errors';
import { THEME_MANIFESTS } from '../../themes/manifests';
import type { ThemeSetting } from '../../themes/contract';

export type ThemeSettings = Readonly<Record<string, string>>;

function manifestSettings(themeId: string): readonly ThemeSetting[] {
  const manifest = THEME_MANIFESTS.find((entry) => entry.id === themeId);
  if (!manifest) throw new HttpError(404, 'Theme not found.', { code: 'theme_unknown' });
  return manifest.settings ?? [];
}

function storedFor(value: unknown, themeId: string): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {};
  const forTheme = (value as Record<string, unknown>)[themeId];
  if (typeof forTheme !== 'object' || forTheme === null) return {};
  return Object.fromEntries(
    Object.entries(forTheme as Record<string, unknown>).filter(([, entry]) => typeof entry === 'string'),
  ) as Record<string, string>;
}

/** What a write may store: a value the theme declared, and nothing else. */
function accept(setting: ThemeSetting, supplied: string | undefined): string | null {
  if (supplied === undefined) return null;
  if (setting.kind === 'switch') return supplied === 'on' || supplied === 'off' ? supplied : null;
  if (setting.kind === 'text') {
    const trimmed = supplied.trim();
    return trimmed.length <= (setting.max ?? 0) ? trimmed : null;
  }
  return setting.options?.some((option) => option.value === supplied) ? supplied : null;
}

/**
 * What a theme has been told, with its own defaults underneath.
 *
 * A key the theme no longer declares is dropped on the way out rather than handed back: a
 * theme that removed a setting should not have to keep understanding it. A key it declares
 * and nobody has chosen comes back as the fallback, so a caller never has to decide what
 * missing means.
 */
export async function readThemeSettings(themeId: string): Promise<ThemeSettings> {
  const settings = manifestSettings(themeId);
  if (!settings.length) return {};
  const row = await db.selectFrom('site_settings').select('theme_settings')
    .where('id', '=', true).executeTakeFirst();
  const stored = storedFor(row?.theme_settings, themeId);
  // A stored value the theme no longer offers is not a value -- a setting whose choices
  // changed in a release, or a row edited by hand, must not reach a template as junk.
  return Object.fromEntries(settings.map((setting) => [
    setting.key, accept(setting, stored[setting.key]) ?? setting.fallback,
  ]));
}

export async function writeThemeSettings(
  ownerId: string,
  input: { id: string; values: Record<string, string> },
): Promise<void> {
  const settings = manifestSettings(input.id);
  const current = await readThemeSettings(input.id);
  const kept: Record<string, string> = {};
  for (const setting of settings) {
    const value = accept(setting, input.values[setting.key]);
    if (value === null && setting.key in input.values) {
      // A length is not a choice: saying a too-long headline is "not offered" sends the
      // owner looking for a list that does not exist.
      const why = setting.kind === 'text'
        ? `is longer than ${setting.max} characters.`
        : 'was sent a value this theme does not offer.';
      throw new HttpError(400, `${setting.label.en} ${why}`, { code: 'theme_setting_invalid' });
    }
    // Absent means leave it, which is what makes a write that touches one control safe.
    kept[setting.key] = value ?? current[setting.key] ?? setting.fallback;
  }
  const updated = await db.updateTable('site_settings')
    .set({ theme_settings: sql`jsonb_set(coalesce(theme_settings, '{}'::jsonb), ${sql.lit(`{${input.id}}`)}, ${JSON.stringify(kept)}::jsonb, true)` })
    .where('id', '=', true).where('owner_id', '=', ownerId)
    .executeTakeFirst();
  if (!updated.numUpdatedRows) throw new HttpError(404, 'Site settings not found.');
}
