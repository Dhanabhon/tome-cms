import { editorText } from '../../lib/editor-content';
import type { EditorDocument, PostLocale } from '../../types/cms';
import { HttpError } from '../http/errors';
import { findSuggester } from '../plugins/suggestions';
import { suggestionBands, type CategorySuggestion } from './category-judgement';
import { listCategories } from './categories';

export type { CategorySuggestion } from './category-judgement';

/** Enough of an article to tell what it is about, and not so much that a request is slow. */
const SAMPLE = 4_000;

/**
 * Which of the owner's own categories this article belongs under, asked of whichever plugin
 * they have switched on for it. Suggestions only: nothing is filed here.
 */
export async function suggestCategories(
  ownerId: string,
  article: { contentJson: EditorDocument; locale: PostLocale; title: string },
): Promise<CategorySuggestion[]> {
  const suggester = await findSuggester(ownerId, 'categoryLikelihoods');
  if (!suggester) return [];
  const categories = await listCategories(ownerId);
  if (!categories.length) return [];
  const text = editorText(article.contentJson).replace(/\s+/g, ' ').trim().slice(0, SAMPLE);
  if (!text && !article.title.trim()) return [];

  const likelihoods = await suggester.plugin.categoryLikelihoods!(suggester.settings, {
    article: { locale: article.locale, text, title: article.title },
    categories: categories.map(({ id, name }) => ({ id, name })),
  });
  // Unavailable is not the same answer as nothing fitting, and the screen says which.
  if (!likelihoods) throw new HttpError(503, 'Suggestions are unavailable right now.', { code: 'judgement_unavailable' });
  return suggestionBands(categories, likelihoods);
}
