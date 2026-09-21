import { choose, hasJudgement } from '../ai/typesafe';
import { editorText } from '../../lib/editor-content';
import { excerptCandidates } from '../../lib/excerpt-candidates';
import type { EditorDocument, PostLocale } from '../../types/cms';
import { acceptedExcerpt, EXCERPT_INSTRUCTIONS, excerptCriteria } from './excerpt-judgement';

/** Enough of an article to judge its passages against. */
const SAMPLE = 6_000;

/**
 * One line from the article that could go under its title on a card.
 *
 * Code finds every passage that could be one; a judgement picks. What comes back is a
 * passage the owner wrote, or nothing -- never a summary nobody wrote.
 */
export async function suggestExcerpt(article: {
  contentJson: EditorDocument;
  locale: PostLocale;
  title: string;
}): Promise<string | null> {
  if (!hasJudgement()) return null;
  const text = editorText(article.contentJson).replace(/\s+/g, ' ').trim();
  const candidates = excerptCandidates(text, article.locale);
  if (!candidates.length) return null;
  const answer = await choose({
    title: article.title,
    language: article.locale === 'th' ? 'Thai' : 'English',
    article: text.slice(0, SAMPLE),
  }, EXCERPT_INSTRUCTIONS, excerptCriteria(candidates));
  return acceptedExcerpt(candidates, answer);
}
