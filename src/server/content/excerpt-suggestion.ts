import { editorText } from '../../lib/editor-content';
import { excerptCandidates } from '../../lib/excerpt-candidates';
import type { EditorDocument, PostLocale } from '../../types/cms';
import { HttpError } from '../http/errors';
import { findSuggester } from '../plugins/suggestions';
import { acceptedExcerpt } from './excerpt-judgement';

/** Enough of an article to judge its passages against. */
const SAMPLE = 6_000;

/**
 * One line from the article that could go under its title on a card.
 *
 * The core finds every passage that could be one; a plugin picks; the core keeps the pick
 * only if it was offered. What comes back is a passage the owner wrote, or nothing.
 */
export async function suggestExcerpt(article: {
  contentJson: EditorDocument;
  locale: PostLocale;
  title: string;
}, ownerId: string): Promise<string | null> {
  const suggester = await findSuggester(ownerId, 'pickExcerpt');
  if (!suggester) return null;
  const text = editorText(article.contentJson).replace(/\s+/g, ' ').trim();
  const candidates = excerptCandidates(text, article.locale);
  if (!candidates.length) return null;
  const answer = await suggester.plugin.pickExcerpt!(suggester.settings, {
    article: { locale: article.locale, text: text.slice(0, SAMPLE), title: article.title },
    candidates,
  });
  // The service not answering is not the article having no good line, and the owner is told
  // which it was.
  if (!answer) throw new HttpError(503, 'Suggestions are unavailable right now.', { code: 'judgement_unavailable' });
  return acceptedExcerpt(candidates, answer.passage);
}
