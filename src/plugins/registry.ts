import type { Plugin } from './contract';

/**
 * Each id maps to a dynamic import, for the reason the themes do: nothing a plugin ships
 * should reach a page that is not using it.
 */
const PLUGINS = {
  lightbox: () => import('./lightbox'),
  notice: () => import('./notice'),
  turnstile: () => import('./turnstile'),
  typesafe: () => import('./typesafe'),
} as const;

export type PluginId = keyof typeof PLUGINS;

export const PLUGIN_IDS = Object.keys(PLUGINS) as PluginId[];

export function isPluginId(value: unknown): value is PluginId {
  return typeof value === 'string' && value in PLUGINS;
}

export async function loadPlugin(id: string): Promise<Plugin | null> {
  return isPluginId(id) ? PLUGINS[id]() : null;
}
