import type { Noul } from '../ai/typesafe';

/** Above this, a category is worth putting in front of the owner. Below, it is noise. */
export const WORTH_SHOWING = 0.6;

export interface CategorySuggestion {
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

/** The ones worth putting in front of the owner, likeliest first. */
export function worthShowing(
  asked: Map<string, AskedCategory>,
  answers: Readonly<Record<string, number>>,
): CategorySuggestion[] {
  return [...asked]
    .map(([id, { category }]) => ({ id: category.id, likelihood: answers[id] ?? 0, name: category.name }))
    .filter(({ likelihood }) => likelihood >= WORTH_SHOWING)
    .sort((left, right) => right.likelihood - left.likelihood);
}
