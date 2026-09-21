import { PLUGIN_IDS, loadPlugin } from '../../plugins/registry';
import type { PublicPage, SiteNotice } from '../../plugins/contract';
import { COLOR, readEnabledPlugin } from './store';

export interface PublicAdditions {
  /** Each enabled plugin whose browser code runs here, in the order they are declared. */
  clients: Array<{ dataset: Readonly<Record<string, string>>; id: string }>;
  /** At most one. Two stacked announcement bars is not a feature. */
  notice: (SiteNotice & { pluginId: string }) | null;
}

/**
 * A link a plugin's settings supplied is a link somebody typed.
 *
 * Same-origin or https, and nothing else -- `javascript:` in a settings field is the first
 * thing an unchecked href would allow, and it would be the owner's own field doing it.
 */
function safeHref(href: string, origin: string): string | null {
  try {
    const url = new URL(href, origin);
    if (url.origin === origin) return `${url.pathname}${url.search}${url.hash}`;
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export async function publicAdditions(ownerId: string, page: PublicPage, origin: string): Promise<PublicAdditions> {
  const additions: PublicAdditions = { clients: [], notice: null };
  for (const pluginId of PLUGIN_IDS) {
    const settings = await readEnabledPlugin(ownerId, pluginId);
    if (!settings) continue;
    const plugin = await loadPlugin(pluginId);
    if (!plugin) continue;

    const notice = plugin.siteNotice?.(settings, page) ?? null;
    if (notice && !additions.notice && notice.text.trim()) {
      const href = notice.link ? safeHref(notice.link.href, origin) : null;
      // Checked here as well as where it was stored: this is the line that turns a setting
      // into CSS on every public page, and a row edited by hand never went through the store.
      const colors = notice.colors && COLOR.test(notice.colors.background) && COLOR.test(notice.colors.text)
        ? notice.colors
        : undefined;
      additions.notice = {
        ...(colors ? { colors } : {}),
        dismissKey: notice.dismissKey,
        pluginId,
        text: notice.text.trim(),
        ...(href && notice.link ? { link: { href, label: notice.link.label } } : {}),
      };
    }

    const client = plugin.publicClient?.(settings, page) ?? null;
    if (client) additions.clients.push({ dataset: client.dataset ?? {}, id: pluginId });
  }
  return additions;
}
