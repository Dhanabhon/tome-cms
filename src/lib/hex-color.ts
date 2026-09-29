/** A colour as the plugin store keeps it (COLOR in server/plugins/store.ts): #rrggbb, lower case. */
export function normalizeHex(input: string): string | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(input.trim());
  return match ? `#${match[1].toLowerCase()}` : null;
}
