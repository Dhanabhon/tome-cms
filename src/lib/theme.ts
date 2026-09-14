/**
 * The three theme states, and the one rule for turning a choice into markup.
 *
 * The stylesheet decides light or dark from the presence of a data-theme attribute:
 * absent means the reader's own system setting wins, 'light' and 'dark' override it
 * in either direction. So 'system' is the *absence* of the attribute, never the
 * string "system" -- a value no CSS rule refers to would work today only by
 * accident, and would break the first time somebody writes a broad [data-theme]
 * selector.
 *
 * Both the public site (which reads the owner's stored choice) and the admin
 * (which reads the reader's own) go through here, so the two cannot drift.
 */
export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];

/** Shared by the inline script, the toggle and the tests, so the key cannot drift. */
export const THEME_STORAGE_KEY = 'tome-theme';

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === 'string' && (THEME_CHOICES as readonly string[]).includes(value);
}

/** Anything unrecognised means the reader's own setting, which is the safe default. */
export function normalizeTheme(value: unknown): ThemeChoice {
  return isThemeChoice(value) ? value : 'system';
}

/** The data-theme value to render, or null to leave the attribute off entirely. */
export function themeAttribute(choice: ThemeChoice): 'light' | 'dark' | null {
  return choice === 'system' ? null : choice;
}
