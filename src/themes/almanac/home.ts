import { dateLocale, publicCopy } from '../../lib/i18n';
import { normalizeNavigationUrl } from '../../lib/navigation-url';
import type { PostLocale } from '../../types/cms';
import type { ThemeHomePost } from '../contract';
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
 * What fills a card's band when the post has no cover: its category's name on that category's
 * tone. The server files a post with no category chosen under the default one, so a post read
 * without any is named for the site instead, and never left a blank band.
 */
export function cardPanel(post: ThemeHomePost, siteName: string): { name: string; tone: number } {
  const [category] = post.categories ?? [];
  return {
    name: category?.name.trim() || siteName,
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
