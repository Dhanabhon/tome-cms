/** The way out, when nothing offered would stand on its own under a title. */
export const NONE = 'none of the above';

export const EXCERPT_INSTRUCTIONS = 'Which passage would best tell someone browsing the homepage what this article is about, '
  + 'read on its own as the line under the title?';

/**
 * The passages as the options themselves, and a way out.
 *
 * An option's name is what comes back, so naming the options with the passages is what makes
 * the answer a passage -- verbatim, because it is one of the keys it was given. The way out
 * matters as much: an article whose opening is a greeting, and whose every other sentence
 * leans on the one before it, has no line that works alone, and a forced pick would put the
 * least bad one on its card.
 */
export function excerptCriteria(candidates: readonly string[]): Record<string, string | null> {
  return {
    ...Object.fromEntries(candidates.map((passage) => [passage, null])),
    [NONE]: 'Each passage leans on what comes before it, or is a greeting or an aside rather than what the article is about.',
  };
}

/**
 * The chosen passage, only if it is one that was offered.
 *
 * Checked rather than trusted: the whole promise is that a card shows words the owner wrote,
 * and this is the line that keeps it. How settled the choice was is not a reason to refuse
 * it -- several passages can be fine at once, which spreads the answer thin, and the owner
 * reads it before it goes anywhere.
 */
export function acceptedExcerpt(candidates: readonly string[], answer: { choice: string } | null): string | null {
  if (!answer || answer.choice === NONE) return null;
  return candidates.includes(answer.choice) ? answer.choice : null;
}
