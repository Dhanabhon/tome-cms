import type { Plugin, PluginSettings } from '../../plugins/contract';
import { pluginManifest } from '../../plugins/manifests';
import { loadPlugin, PLUGIN_IDS } from '../../plugins/registry';
import { readEnabledPlugin } from './store';

type SuggestionMethod = 'categoryLikelihoods' | 'pickExcerpt';

/**
 * The plugin this owner has switched on that can make a given kind of suggestion, if any.
 *
 * The manifest is asked first, so a plugin that does not claim the hook is never loaded or
 * has its settings opened to find out. None is the ordinary case: an installation that has
 * not chosen to send anything anywhere suggests nothing, and draws no button for it.
 */
export async function findSuggester(
  ownerId: string,
  method: SuggestionMethod,
): Promise<{ plugin: Plugin; settings: PluginSettings } | null> {
  for (const id of PLUGIN_IDS) {
    if (!pluginManifest(id)?.hooks.includes('editorSuggestions')) continue;
    const settings = await readEnabledPlugin(ownerId, id);
    if (!settings) continue;
    const plugin = await loadPlugin(id);
    if (plugin?.[method]) return { plugin, settings };
  }
  return null;
}

/** Whether the editors should draw their suggestion buttons at all. */
export async function suggestionsAvailable(ownerId: string): Promise<boolean> {
  return Boolean((await findSuggester(ownerId, 'categoryLikelihoods')) ?? (await findSuggester(ownerId, 'pickExcerpt')));
}
