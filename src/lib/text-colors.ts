/**
 * The text colours a writer can choose, by name. The editor's mark and the sanitizer both read
 * this list, and each theme gives every name a shade for light and for dark.
 */
export const TEXT_COLORS = ['red', 'orange', 'green', 'blue', 'purple', 'grey'] as const;
export type TextColor = (typeof TEXT_COLORS)[number];

export function isTextColor(value: unknown): value is TextColor {
  return typeof value === 'string' && (TEXT_COLORS as readonly string[]).includes(value);
}
