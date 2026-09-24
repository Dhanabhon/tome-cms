import { sql } from 'kysely';

import { pluginManifest, PLUGIN_MANIFESTS } from '../../plugins/manifests';
import type { PluginSettings } from '../../plugins/contract';
import { db } from '../db/client';
import { HttpError } from '../http/errors';
import { isUuid } from '../media/keys';
import { assertReadyMediaReferences } from '../media/service';
import { isSealed, openSecret, sealSecret } from './secrets';

/** The one shape of colour a style attribute can be trusted with. */
export const COLOR = /^#[0-9a-f]{6}$/i;

/** What the admin is allowed to see: a secret is only ever reported as set or not. */
export interface PluginState {
  configured: boolean;
  enabled: boolean;
  id: string;
  /** Text settings by key; a secret's key maps to whether one is stored. */
  secrets: Record<string, boolean>;
  values: Record<string, string>;
}

function rowSettings(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, entry]) => typeof entry === 'string'),
  ) as Record<string, string>;
}

export async function readPluginStates(ownerId: string): Promise<PluginState[]> {
  const rows = await db.selectFrom('plugin_settings').selectAll().where('owner_id', '=', ownerId).execute();
  return PLUGIN_MANIFESTS.map((manifest) => {
    const stored = rowSettings(rows.find((row) => row.id === manifest.id)?.settings);
    const values: Record<string, string> = {};
    const secrets: Record<string, boolean> = {};
    for (const setting of manifest.settings) {
      if (setting.kind === 'secret') secrets[setting.key] = isSealed(stored[setting.key]);
      else values[setting.key] = stored[setting.key] || setting.fallback || '';
    }
    return {
      configured: manifest.settings.every((setting) => setting.kind === 'secret'
        ? !setting.required || secrets[setting.key]
        : !setting.required || Boolean(values[setting.key])),
      enabled: rows.find((row) => row.id === manifest.id)?.enabled ?? false,
      id: manifest.id,
      secrets,
      values,
    };
  });
}

/**
 * What the server may use: the settings as the plugin will read them, secrets opened.
 *
 * Returns null unless the plugin is switched on, so a caller cannot accidentally run a
 * plugin the owner turned off by reading its settings and finding them filled in.
 */
export async function readEnabledPlugin(ownerId: string, id: string): Promise<PluginSettings | null> {
  const row = await db.selectFrom('plugin_settings').selectAll()
    .where('owner_id', '=', ownerId).where('id', '=', id).where('enabled', '=', true).executeTakeFirst();
  if (!row) return null;
  const manifest = pluginManifest(id);
  if (!manifest) return null;
  const stored = rowSettings(row.settings);
  const settings: Record<string, string> = {};
  for (const setting of manifest.settings) {
    const value = stored[setting.key] ?? '';
    if (setting.kind !== 'secret') settings[setting.key] = value || setting.fallback || '';
    else {
      const opened = value ? openSecret(value) : null;
      // A secret that will not open is a secret this build cannot use: treat it as absent
      // rather than passing ciphertext to a plugin that would send it somewhere.
      if (opened !== null) settings[setting.key] = opened;
    }
  }
  return settings;
}

export async function writePluginSettings(ownerId: string, input: {
  enabled: boolean;
  id: string;
  values: Record<string, string>;
}): Promise<void> {
  const manifest = pluginManifest(input.id);
  if (!manifest) throw new HttpError(404, 'Plugin not found.', { code: 'plugin_unknown' });
  const existing = rowSettings(
    (await db.selectFrom('plugin_settings').select('settings')
      .where('owner_id', '=', ownerId).where('id', '=', input.id).executeTakeFirst())?.settings,
  );

  const settings: Record<string, string> = {};
  for (const setting of manifest.settings) {
    const supplied = input.values[setting.key]?.trim();
    if (supplied !== undefined && setting.kind === 'switch' && supplied !== 'on' && supplied !== 'off') {
      throw new HttpError(400, `${setting.label.en} is on or off.`, { code: 'plugin_setting_invalid' });
    }
    if (supplied !== undefined && setting.kind === 'color' && !COLOR.test(supplied)) {
      // Refused rather than cleaned: this lands in a style attribute on every public page,
      // and the only colour that is safe to put there is one that is nothing but a colour.
      throw new HttpError(400, `${setting.label.en} is a colour like #000000.`, { code: 'plugin_setting_invalid' });
    }
    if (supplied !== undefined && setting.kind === 'choice' && !setting.options?.some((option) => option.value === supplied)) {
      throw new HttpError(400, `${setting.label.en} is one of its choices.`, { code: 'plugin_setting_invalid' });
    }
    if (supplied && setting.kind === 'image') {
      // An id the library knows, of a picture that is ready and this owner's -- the store is the
      // one place every write passes, and the library refuses to delete what this names.
      if (!isUuid(supplied)) throw new HttpError(400, 'Choose media from this site.', { code: 'plugin_setting_invalid' });
      await assertReadyMediaReferences(db, ownerId, [supplied.toLowerCase()]);
    }
    if (setting.kind !== 'secret') {
      // Absent is not empty. A request that only switches the plugin on does not have to
      // restate the fields it is not touching, and before this it erased them by omission
      // -- which a secret was already safe from, and a site key was not.
      const kept = supplied ?? existing[setting.key] ?? '';
      settings[setting.key] = setting.kind === 'color' || setting.kind === 'image' ? kept.toLowerCase() : kept;
      continue;
    }
    // Blank means "keep what is stored": the browser was never told the secret, so it
    // cannot send it back, and a save of the rest of the form must not erase it.
    if (supplied) settings[setting.key] = sealSecret(supplied);
    else if (isSealed(existing[setting.key])) settings[setting.key] = existing[setting.key];
  }

  const missing = manifest.settings.find((setting) => setting.required && !settings[setting.key]);
  if (input.enabled && missing) {
    throw new HttpError(400, `${missing.label.en} is required to switch this on.`, { code: 'plugin_incomplete' });
  }

  await db.insertInto('plugin_settings')
    .values({ enabled: input.enabled, id: input.id, owner_id: ownerId, settings: JSON.stringify(settings) })
    .onConflict((conflict) => conflict.column('id').doUpdateSet({
      enabled: input.enabled,
      settings: JSON.stringify(settings),
      updated_at: sql<Date>`now()`,
    }))
    .execute();
}
