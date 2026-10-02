import type { PublicNavigationItem } from '../types/cms';

/**
 * Whether a header item is the section of the page being viewed: one of its sub-items is that page.
 * The theme works this out from the request path, so the cached menu does not depend on the page.
 */
export function isCurrentSection(item: PublicNavigationItem, pathname: string): boolean {
  return item.children.some((child) => child.href === pathname);
}

/** A menu item that leads somewhere: the footer holds only these, since it has no groups. */
export const isLink = (item: PublicNavigationItem): item is PublicNavigationItem & { href: string } => item.href !== null;
