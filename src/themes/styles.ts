import { DEFAULT_THEME_ID, isThemeId } from './registry';

/**
 * Where a theme's stylesheet is served from.
 *
 * It is linked rather than imported by the templates, and that is not a style choice. A
 * theme is reached only through the registry's dynamic import, so nothing statically links
 * a page to the components it will render -- and Vite, asked to attribute their CSS to
 * something, attributed all of it to the one bundle that names the registry statically: the
 * admin's settings form. The public pages shipped with no stylesheet at all, the settings
 * screen shipped with every theme's, and neither the dev server nor a diff of the selectors
 * served showed it, because both were true of the build as a whole.
 *
 * Asking Vite for the URL instead makes each theme's stylesheet an asset of its own, linked
 * by whatever renders that theme and downloaded by no one else.
 */
const STYLESHEETS = import.meta.glob<string>('./*/theme.css', { eager: true, import: 'default', query: '?url' });

export function themeStylesheet(id?: string | null): string {
  return STYLESHEETS[`./${isThemeId(id) ? id : DEFAULT_THEME_ID}/theme.css`] ?? '';
}
