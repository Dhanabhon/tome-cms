/**
 * Three answers, not two.
 *
 * One line at 0.6 made 0.59 invisible and gave 0.61 the same standing as 0.99, when both
 * sides of that line are the judgement saying it is not sure. Between the two bands below is
 * where it says so, and that is shown as a maybe for the owner to decide rather than decided
 * either way on their behalf.
 *
 * This is the core's policy, not a plugin's: a plugin supplies likelihoods, and what the
 * owner is shown is decided here, the same whichever plugin supplied them.
 *
 * The numbers are TypeSafe's cookbook starting point, which it calls illustrative. They are
 * named so they can move once there are enough of this owner's articles to measure against.
 */
export const LIKELY = 0.7;
export const POSSIBLE = 0.3;

export interface CategorySuggestion {
  /** Likely: suggest it. Possible: offer it as a maybe. Anything lower is not shown. */
  band: 'likely' | 'possible';
  id: string;
  likelihood: number;
  name: string;
}

/**
 * The owner's categories worth showing, each in its band, likeliest first. A category the
 * judgement did not answer for reads as absent -- never as a confident no, never as a yes.
 */
export function suggestionBands(
  categories: readonly { id: string; name: string }[],
  likelihoods: Readonly<Record<string, number>>,
): CategorySuggestion[] {
  return categories
    .map((category) => ({ id: category.id, likelihood: likelihoods[category.id] ?? 0, name: category.name }))
    .filter(({ likelihood }) => likelihood >= POSSIBLE)
    .map((suggestion) => ({ ...suggestion, band: suggestion.likelihood >= LIKELY ? 'likely' as const : 'possible' as const }))
    .sort((left, right) => right.likelihood - left.likelihood);
}
