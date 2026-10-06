import type { ThemeHomeProps } from './contract';

/**
 * The address of a page of the list on screen, from its newest post or from where a page stopped:
 * the home's, with the filter and the search it has, or a category's own page, which needs neither.
 */
export function listHref(
  home: string,
  { activeCategory, category, query }: Pick<ThemeHomeProps, 'activeCategory' | 'category' | 'query'>,
  cursor?: string,
): string {
  const search = new URLSearchParams([
    ...(activeCategory && !category ? [['category', activeCategory]] : []),
    ...(query ? [['q', query]] : []),
    ...(cursor ? [['cursor', cursor]] : []),
  ]).toString();
  const base = category?.path ?? home;
  return search ? `${base}?${search}` : base;
}
