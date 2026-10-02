import type { Selectable } from 'kysely';

import { localePath } from '../../lib/i18n';
import { normalizeNavigationUrl } from '../../lib/navigation-url';
import type { PageLocale, PublicNavigation, PublicNavigationItem } from '../../types/cms';
import type { NavigationItemTable } from '../db/types';

export type PublicNavigationRow = Pick<
  Selectable<NavigationItemTable>,
  'id' | 'kind' | 'label' | 'location' | 'new_tab' | 'page_id' | 'parent_id' | 'url'
>;

/**
 * Rows in running order, and the paths of the pages that are live, become the menu a visitor sees.
 * A link that leads nowhere is dropped; a parent that lost its own link but kept live sub-items
 * is shown as a group, and a group with nothing under it is dropped.
 */
export function buildPublicNavigation(
  rows: PublicNavigationRow[],
  pageUrls: ReadonlyMap<string, string>,
  locale: PageLocale,
): PublicNavigation {
  const navigation: PublicNavigation = { footer: [], header: [] };
  const hrefOf = (row: PublicNavigationRow) => row.kind === 'home' ? localePath(locale)
    : row.kind === 'page' ? pageUrls.get(row.page_id ?? '')
      : row.kind === 'custom' ? normalizeNavigationUrl(row.url ?? '')
        : null;
  const subItems = new Map<string, PublicNavigationItem[]>();
  for (const row of rows) {
    if (!row.parent_id) continue;
    const href = hrefOf(row);
    if (!href) continue;
    const siblings = subItems.get(row.parent_id) ?? [];
    siblings.push({ href, kind: row.kind, label: row.label, newTab: row.new_tab, children: [] });
    subItems.set(row.parent_id, siblings);
  }
  for (const row of rows) {
    // The footer is flat: it never shows sub-items, and a group would have nothing under it.
    const children = row.location === 'header' ? subItems.get(row.id) ?? [] : [];
    const href = hrefOf(row);
    const item: PublicNavigationItem | null = href
      ? { href, kind: row.kind, label: row.label, newTab: row.new_tab, children }
      : children.length ? { href: null, kind: 'group', label: row.label, newTab: false, children } : null;
    if (!row.parent_id && item && navigation[row.location].length < 50) navigation[row.location].push(item);
  }
  return navigation;
}
