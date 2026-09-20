import type { Plugin, PluginSettings, SignInVerdict, SignInWidget } from '../../plugins/contract';
import { loadPlugin, PLUGIN_IDS } from '../../plugins/registry';
import { readEnabledPlugin } from './store';

export interface ActiveSignInWidget {
  /** Which plugin put it there, so the check is asked of the same one. */
  pluginId: string;
  widget: SignInWidget;
}

interface ActivePlugin {
  plugin: Plugin;
  pluginId: string;
  settings: PluginSettings;
  widget: SignInWidget;
}

/**
 * The one plugin standing in front of the sign-in.
 *
 * One, not a list: two challenges on one form is two tokens, two verdicts and a question
 * about what happens when they disagree, and the owner who switched both on did not mean
 * to ask it. Resolved once, so the plugin that drew the widget is the plugin asked about
 * the answer -- they cannot come apart.
 */
async function activePlugin(ownerId: string): Promise<ActivePlugin | null> {
  for (const pluginId of PLUGIN_IDS) {
    const settings = await readEnabledPlugin(ownerId, pluginId);
    if (!settings) continue;
    const plugin = await loadPlugin(pluginId);
    const widget = plugin?.signInWidget(settings) ?? null;
    if (plugin && widget) return { plugin, pluginId, settings, widget };
  }
  return null;
}

export async function activeSignInWidget(ownerId: string): Promise<ActiveSignInWidget | null> {
  const active = await activePlugin(ownerId);
  return active ? { pluginId: active.pluginId, widget: active.widget } : null;
}

/**
 * What the enabled plugin makes of an attempt. Null when no plugin is standing there.
 *
 * A plugin that throws is a plugin that is unavailable, not a visitor who failed: whatever
 * went wrong in it is this installation's problem and not the problem of the person trying
 * to sign in to it.
 */
export async function guardSignIn(input: {
  ownerId: string;
  remoteIp: string | null;
  token: string | null;
}): Promise<(SignInVerdict & { pluginId: string }) | null> {
  const active = await activePlugin(input.ownerId);
  if (!active) return null;
  try {
    const verdict = await active.plugin.verifySignIn({
      remoteIp: input.remoteIp,
      settings: active.settings,
      token: input.token,
    });
    return { ...verdict, pluginId: active.pluginId };
  } catch (error) {
    return {
      detail: error instanceof Error ? error.message : 'the plugin failed',
      outcome: 'unavailable',
      pluginId: active.pluginId,
    };
  }
}
