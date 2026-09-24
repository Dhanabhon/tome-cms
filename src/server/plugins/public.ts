import { PLUGIN_IDS, loadPlugin } from '../../plugins/registry';
import type { PublicPage, SiteNotice, SitePopup } from '../../plugins/contract';
import { ACCEPTED_IMAGE_TYPES } from '../../lib/media';
import { db } from '../db/client';
import { isUuid } from '../media/keys';
import { stableMediaPath } from '../media/url';
import { COLOR, readEnabledPlugin } from './store';

/** A popup as the core will draw it: its link checked, its picture resolved or dropped. */
export interface PublicPopup extends Omit<SitePopup, 'delaySeconds' | 'imageId'> {
  delaySeconds: number;
  image: { height: number; src: string; width: number } | null;
  pluginId: string;
}

export interface PublicAdditions {
  /** Each enabled plugin whose browser code runs here, in the order they are declared. */
  clients: Array<{ dataset: Readonly<Record<string, string>>; id: string }>;
  /** At most one. Two stacked announcement bars is not a feature. */
  notice: (SiteNotice & { pluginId: string }) | null;
  /** At most one, for the same reason. */
  popup: PublicPopup | null;
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

/** The picture, while it is still a ready image of this owner's; otherwise the popup goes without. */
async function popupImage(ownerId: string, id: string): Promise<PublicPopup['image']> {
  if (!isUuid(id)) return null;
  const row = await db.selectFrom('media_items').select(['id', 'width', 'height'])
    .where('owner_id', '=', ownerId).where('id', '=', id.toLowerCase()).where('state', '=', 'ready')
    .where('mime_type', 'in', [...ACCEPTED_IMAGE_TYPES])
    .executeTakeFirst();
  return row?.width && row.height ? { height: row.height, src: stableMediaPath(row.id), width: row.width } : null;
}

const DISMISS_KEY = /^[A-Za-z0-9-]{1,80}$/;

/** A popup the core can draw, or null: a heading, a button and a link it trusts. */
async function checkedPopup(ownerId: string, pluginId: string, popup: SitePopup, origin: string): Promise<PublicPopup | null> {
  const heading = popup.heading.trim();
  const label = popup.action.label.trim();
  const href = safeHref(popup.action.href, origin);
  if (!heading || !label || !href || !DISMISS_KEY.test(popup.dismissKey)) return null;
  const delay = popup.delaySeconds;
  return {
    action: { href, label },
    ...(popup.decline?.trim() ? { decline: popup.decline.trim() } : {}),
    delaySeconds: Number.isInteger(delay) && delay! >= 0 && delay! <= 60 ? delay! : 10,
    dismissKey: popup.dismissKey,
    ...(popup.finePrint?.trim() ? { finePrint: popup.finePrint.trim() } : {}),
    heading,
    image: popup.imageId ? await popupImage(ownerId, popup.imageId) : null,
    pluginId,
    ...(popup.text?.trim() ? { text: popup.text.trim() } : {}),
    trigger: popup.trigger === 'exit' ? 'exit' : 'delay',
  };
}

export async function publicAdditions(ownerId: string, page: PublicPage, origin: string): Promise<PublicAdditions> {
  const additions: PublicAdditions = { clients: [], notice: null, popup: null };
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

    const popup = additions.popup ? null : plugin.sitePopup?.(settings, page) ?? null;
    if (popup) additions.popup = await checkedPopup(ownerId, pluginId, popup, origin);

    const client = plugin.publicClient?.(settings, page) ?? null;
    if (client) additions.clients.push({ dataset: client.dataset ?? {}, id: pluginId });
  }
  return additions;
}
