import { dateLocale, publicCopy } from '../../lib/i18n';
import { normalizeNavigationUrl } from '../../lib/navigation-url';
import type { Post, PostCategoryBadge, PostLocale } from '../../types/cms';
import { tone } from './tone';

/**
 * Where a hero button goes: the owner's link, or the theme's when they left it blank.
 *
 * The owner's must be a path on this site or an https address -- the menu's rule, less plain
 * http, which is what the setting's hint promises. The settings store checks only a text's
 * length, so a link it kept that fails here is not drawn at all rather than drawn broken.
 * A null fallback means the theme has nowhere to send the reader either.
 */
export function heroLink(value: string | undefined, fallback: string | null): string | null {
  if (!value?.trim()) return fallback;
  const link = normalizeNavigationUrl(value);
  return link && !link.startsWith('http:') ? link : null;
}

/**
 * The categories the home route's posts carry. The contract types them as Post, but the route
 * hands over the published read, which has each post's categories on it; the type has no room
 * for them and the contract is not changed for a theme, so they are read for what they are.
 */
function firstCategory(post: Post): PostCategoryBadge | undefined {
  const { categories } = post as Post & { categories?: unknown };
  const [first] = Array.isArray(categories) ? categories : [];
  return typeof first?.id === 'string' && typeof first.name === 'string' ? first : undefined;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** A grapheme, not a code unit: a Thai letter keeps its marks, and a vowel written before its
 *  consonant (เ แ โ ใ ไ) alone reads as a stray stroke, so it takes its consonant along. */
function firstLetter(words: string): string {
  const [first = '', second = ''] = [...graphemes.segment(words.trim())].map(({ segment }) => segment);
  return (/^[เ-ไ]$/u.test(first) ? first + second : first).toLocaleUpperCase();
}

/** What fills a card's panel when the post has no cover: a letter on its category's tone. */
export function cardPanel(post: Post, siteName: string): { letter: string; tone: number } {
  const category = firstCategory(post);
  return {
    letter: firstLetter(category?.name ?? '') || firstLetter(siteName),
    // Posts with no category share one tone, so they read as one kind of thing.
    tone: tone(category?.id ?? ''),
  };
}

/**
 * The line under a card's excerpt: "5 min read" and "28 Sep", the day as it was where the site
 * is. The year is said only when it is not this one, so last year's post does not pass for new.
 * Day before month in both languages, from the parts rather than a pattern, so neither
 * language's order is written down here.
 */
export function cardMeta(minutes: number, iso: string, locale: PostLocale, timeZone: string, now = new Date()) {
  const parts = (date: Date) => Object.fromEntries(new Intl.DateTimeFormat(dateLocale(locale), {
    day: 'numeric', month: 'short', timeZone, year: 'numeric',
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  const day = parts(new Date(iso));
  const date = [day.day, day.month, day.year === parts(now).year ? '' : day.year].filter(Boolean).join(' ');
  return { date, reading: publicCopy(locale).minutesRead.replace('{minutes}', String(minutes)) };
}
