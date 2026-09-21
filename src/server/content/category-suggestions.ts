import { ask, hasJudgement } from '../ai/typesafe';
import { categoryQuestions, suggestionBands, type CategorySuggestion } from './category-judgement';
import { editorText } from '../../lib/editor-content';
import { listCategories } from './categories';
import type { EditorDocument, PostLocale } from '../../types/cms';

export type { CategorySuggestion } from './category-judgement';

/** Enough of an article to tell what it is about, and not so much that a request is slow. */
const SAMPLE = 4_000;

/**
 * Which of the owner's own categories this article belongs under.
 *
 * One yes-or-no judgement per category rather than one pick, because an article belongs
 * under as many as it belongs under -- and because a forced pick would file every article
 * somewhere even when none of them fit.
 *
 * The categories are the owner's, read from their own rows: nothing here invents a name,
 * and a category that was renamed is asked about under the name it has now.
 *
 * Suggestions only. Nothing is filed by this function; the drawer offers them and the
 * owner ticks what they agree with, which is also what makes a wrong answer cost nothing.
 */
export async function suggestCategories(
  ownerId: string,
  article: { contentJson: EditorDocument; locale: PostLocale; title: string },
): Promise<CategorySuggestion[]> {
  if (!hasJudgement()) return [];
  const categories = await listCategories(ownerId);
  if (!categories.length) return [];

  const body = editorText(article.contentJson).replace(/\s+/g, ' ').trim().slice(0, SAMPLE);
  if (!body && !article.title.trim()) return [];

  const asked = categoryQuestions(categories);
  const answers = await ask({
    title: article.title,
    language: article.locale === 'th' ? 'Thai' : 'English',
    body,
  }, Object.fromEntries([...asked].map(([id, { question }]) => [id, question])));
  return answers ? suggestionBands(asked, answers) : [];
}
