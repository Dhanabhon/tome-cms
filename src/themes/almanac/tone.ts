/** How many panel tones the stylesheet declares: --almanac-tone-0 to --almanac-tone-5. */
export const TONE_COUNT = 6;

/**
 * The panel tone a category's cards are drawn in when a post has no cover.
 *
 * A hash of the id rather than its position in a list, so a category keeps its tone when
 * another is added, removed or renamed. FNV-1a over the UTF-16 code units: small, and the
 * same answer on every runtime and in every release.
 */
export function tone(categoryId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < categoryId.length; index += 1) {
    hash = Math.imul(hash ^ categoryId.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash % TONE_COUNT;
}
