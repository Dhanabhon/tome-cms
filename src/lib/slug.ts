import slugify from 'slugify';

/** How long an address may be, in characters -- one Thai letter is one of them. */
export const SLUG_LENGTH = 160;

const THAI = /\p{Script=Thai}/u;
const KEPT_IN_THAI = /[a-z0-9\p{Script=Thai}]/u;

/**
 * What a slug may be: lowercase Latin letters and digits, Thai, and single hyphens between.
 *
 * It was `[a-z0-9]` alone, so a Thai title could not have a Thai address even when one was
 * typed by hand. Thai is named by script rather than let in as "any letter": this is a
 * bilingual site in two languages, and an address is not the place to find out what a third
 * one does to a route.
 */
export const SLUG = /^(?:[a-z0-9]|\p{Script=Thai})+(?:-(?:[a-z0-9]|\p{Script=Thai})+)*$/u;

/**
 * The address a title suggests, in the words it was written in.
 *
 * `slugify` in strict mode keeps what it can transliterate and drops the rest, and it has
 * nothing for Thai -- so a Thai title became an empty string and then `post-a1b2c3d4`, and a
 * mixed one kept only its English: "รวมทุกความคิดไว้ใน TomeCMS" was `tomecms`. The owner of this
 * site writes mostly in Thai, so most of its addresses said nothing about their articles.
 *
 * The words are ICU's, not the spaces'. Thai is written without spaces between words, so a
 * title split on whitespace is one long run of letters; split into words it reads the way an
 * English slug does, a word between each pair of hyphens. Latin words still go through
 * slugify, which is what turns "café" into "cafe".
 *
 * Idempotent, which is the property that keeps every existing address where it is: each save
 * normalises the slug it is given, and a slug that is already one comes back unchanged.
 */
export function contentSlug(value: string): string {
  let slug = '';
  const words = new Intl.Segmenter('th', { granularity: 'word' }).segment(value.normalize('NFC').toLowerCase());
  for (const { isWordLike, segment } of words) {
    if (!isWordLike) continue;
    const word = THAI.test(segment)
      ? [...segment].filter((character) => KEPT_IN_THAI.test(character)).join('')
      : slugify(segment, { lower: true, strict: true, trim: true });
    if (!word) continue;
    const next = slug ? `${slug}-${word}` : word;
    // Whole words or nothing: an address cut mid-word is a misspelt one.
    if (next.length > SLUG_LENGTH) break;
    slug = next;
  }
  return slug;
}
