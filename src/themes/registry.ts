/**
 * The themes this installation ships with.
 *
 * Each id maps to a *dynamic* import, which is the whole point of this file. Importing the
 * themes directly would bundle every one of their stylesheets into every public page, so a
 * reader would download the look of themes the owner did not choose -- the exact cost this
 * structure exists to avoid. A dynamic import lets Vite split them, and the server loads
 * only the one the settings name.
 *
 * Mind the prose in this directory: Tailwind scans these files for class names, and a bare
 * utility word written in a comment ships that rule to every reader on the site.
 */
const THEMES = {
  paper: () => import('./paper'),
} as const;

export type ThemeId = keyof typeof THEMES;

export const DEFAULT_THEME_ID: ThemeId = 'paper';

export const THEME_IDS = Object.keys(THEMES) as ThemeId[];

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && value in THEMES;
}

/**
 * A theme the settings do not name, or name wrongly, is the default one.
 *
 * An id can outlive the theme it named -- a theme removed from a release, a database
 * restored onto a newer build -- and a site that answers that with a blank page has turned
 * a cosmetic setting into an outage.
 */
export function resolveTheme(id?: string | null) {
  return THEMES[isThemeId(id) ? id : DEFAULT_THEME_ID]();
}
