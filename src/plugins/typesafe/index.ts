import type { ArticleDraft, Plugin, PluginSettings, SignInVerdict, SignInWidget } from '../contract';
import { ask, choose } from './api';
import { categoryQuestions, EXCERPT_INSTRUCTIONS, excerptCriteria, NONE } from './questions';

export { manifest } from './plugin';

/** Nothing to add to the sign-in: this plugin is about the page an owner writes. */
export function signInWidget(): SignInWidget | null {
  return null;
}

export async function verifySignIn(): Promise<SignInVerdict> {
  return { outcome: 'passed', detail: 'TypeSafe does not guard anything' };
}

const stateOf = (article: ArticleDraft) => ({
  title: article.title,
  language: article.locale === 'th' ? 'Thai' : 'English',
  article: article.text,
});

/**
 * How likely the article belongs under each of the owner's categories, by the category's id.
 * Asked all at once: independent questions over one article are answered in parallel.
 */
export async function categoryLikelihoods(
  settings: PluginSettings,
  input: { article: ArticleDraft; categories: readonly { id: string; name: string }[] },
): Promise<Record<string, number> | null> {
  if (!settings.apiKey) return null;
  const asked = categoryQuestions(input.categories);
  const answers = await ask(settings.apiKey, stateOf(input.article),
    Object.fromEntries([...asked].map(([id, { question }]) => [id, question])));
  if (!answers) return null;
  return Object.fromEntries([...asked].map(([id, { category }]) => [category.id, answers[id] ?? 0]));
}

/** Which of the offered passages best introduces the article, or none of them. */
export async function pickExcerpt(
  settings: PluginSettings,
  input: { article: ArticleDraft; candidates: readonly string[] },
): Promise<{ passage: string | null } | null> {
  if (!settings.apiKey || !input.candidates.length) return null;
  const answer = await choose(settings.apiKey, stateOf(input.article), EXCERPT_INSTRUCTIONS, excerptCriteria(input.candidates));
  if (!answer) return null;
  return { passage: answer.choice === NONE ? null : answer.choice };
}

const plugin: Plugin = { categoryLikelihoods, pickExcerpt, signInWidget, verifySignIn };
export default plugin;
