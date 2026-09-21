import type { Noul } from '../ai/typesafe';

/**
 * Three answers, not two.
 *
 * One line at 0.6 made 0.59 invisible and gave 0.61 the same standing as 0.99, when both
 * sides of that line are the model saying it is not sure. Between the two bands below is
 * where it says so, and that is shown as a maybe for the owner to decide rather than
 * decided either way on their behalf. The escalation is arithmetic over the probability
 * already returned: no second question, no second request.
 *
 * The numbers are the cookbook's starting point, and it says plainly that they are
 * illustrative. They are named here so they can be moved once there are enough of this
 * owner's own articles to measure them against.
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

export interface AskedCategory {
  category: { id: string; name: string };
  question: Noul;
}

/**
 * One question per category, each carrying the category's own name.
 *
 * Question ids are for this code and are never sent, so a question that says "this one"
 * says nothing. The criteria are what keep a passing mention from filing an article:
 * without them "does this belong under Design?" is true of anything that says the word.
 */
export function categoryQuestions(
  categories: readonly { id: string; name: string }[],
): Map<string, AskedCategory> {
  return new Map(categories.map((category, index) => [`c${index}`, {
    category,
    question: {
      instructions: `Does this article belong under the category "${category.name}"?`,
      criteria: {
        true: `The article is substantially about "${category.name}", such that a reader browsing that category would expect to find it.`,
        false: `The article only mentions "${category.name}" in passing, or is about something else.`,
      },
    },
  }]));
}

/** The ones worth putting in front of the owner, each in its band, likeliest first. */
export function suggestionBands(
  asked: Map<string, AskedCategory>,
  answers: Readonly<Record<string, number>>,
): CategorySuggestion[] {
  return [...asked]
    .map(([id, { category }]) => ({ id: category.id, likelihood: answers[id] ?? 0, name: category.name }))
    .filter(({ likelihood }) => likelihood >= POSSIBLE)
    .map((suggestion) => ({ ...suggestion, band: suggestion.likelihood >= LIKELY ? 'likely' as const : 'possible' as const }))
    .sort((left, right) => right.likelihood - left.likelihood);
}
