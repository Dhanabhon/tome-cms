import { manifest as lightbox } from './lightbox/plugin';
import { manifest as notice } from './notice/plugin';
import { manifest as turnstile } from './turnstile/plugin';
import { manifest as typesafe } from './typesafe/plugin';
import type { PluginManifest } from './contract';

/**
 * What the admin needs to offer a plugin: a name, a sentence and the fields it wants.
 * Nothing here pulls a plugin's implementation into the screen doing the offering.
 */
export const PLUGIN_MANIFESTS: readonly PluginManifest[] = [turnstile, notice, lightbox, typesafe];

export function pluginManifest(id: string): PluginManifest | null {
  return PLUGIN_MANIFESTS.find((manifest) => manifest.id === id) ?? null;
}
