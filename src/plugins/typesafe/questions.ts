import type { Noul } from './api';

/**
 * How TypeSafe is asked. Kept apart from the requests so the wording can be read, and
 * tested, without a key or a network.
 */

/**
 * One question per category, each carrying the category's own name.
 *
 * Question ids are this code's and are never sent, so a question that says "this one" says
 * nothing. The criteria are what keep a passing mention from filing an article: without
 * them "does this belong under Design?" is true of anything that says the word.
 */
export function categoryQuestions(
  categories: readonly { id: string; name: string }[],
): Map<string, { category: { id: string; name: string }; question: Noul }> {
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

/** The way out, when nothing offered would stand on its own under a title. */
export const NONE = 'none of the above';

export const EXCERPT_INSTRUCTIONS = 'Which passage would best tell someone browsing the homepage what this article is about, '
  + 'read on its own as the line under the title?';

/**
 * The passages as the options themselves, and a way out. An option's name is what comes
 * back, so naming the options with the passages makes the answer a passage. The way out
 * matters as much: an article whose every sentence leans on the one before has no line that
 * works alone, and a forced pick would put the least bad one on its card.
 */
export function excerptCriteria(candidates: readonly string[]): Record<string, string | null> {
  return {
    ...Object.fromEntries(candidates.map((passage) => [passage, null])),
    [NONE]: 'Each passage leans on what comes before it, or is a greeting or an aside rather than what the article is about.',
  };
}
