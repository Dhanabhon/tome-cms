/**
 * The chosen passage, only if it is one that was offered.
 *
 * Checked rather than trusted, whichever plugin answered: the whole promise is that a card
 * shows words the owner wrote, and this is the line that keeps it. How settled the choice was
 * is not a reason to refuse it -- several passages can be fine at once, which spreads an
 * answer thin, and the owner reads it before it goes anywhere.
 */
export function acceptedExcerpt(candidates: readonly string[], passage: string | null): string | null {
  return passage !== null && candidates.includes(passage) ? passage : null;
}
