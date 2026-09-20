import type { SignInWidget } from '../../plugins/contract';
import { loadPlugin, PLUGIN_IDS } from '../../plugins/registry';
import { readEnabledPlugin } from './store';

export interface ActiveSignInWidget {
  /** Which plugin put it there, so the check can be asked of the same one. */
  pluginId: string;
  widget: SignInWidget;
}

/**
 * The one challenge the sign-in form may carry.
 *
 * One, not a list: two challenges on one form is two tokens, two verdicts and a question
 * about what happens when they disagree, and the owner who switched both on did not mean to
 * ask it. The first plugin that offers one gets it, and the rest of the form is unchanged.
 */
export async function activeSignInWidget(ownerId: string): Promise<ActiveSignInWidget | null> {
  for (const pluginId of PLUGIN_IDS) {
    const settings = await readEnabledPlugin(ownerId, pluginId);
    if (!settings) continue;
    const plugin = await loadPlugin(pluginId);
    const widget = plugin?.signInWidget(settings) ?? null;
    if (widget) return { pluginId, widget };
  }
  return null;
}
