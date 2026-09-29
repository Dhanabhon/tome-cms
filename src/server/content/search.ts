/**
 * What a reader typed into the search box, as the words to find.
 *
 * ponytail: a substring match over a post's title, its excerpt and its body with the markup
 * taken out, run as ILIKE with no index. It reads every published post of the language for
 * each search, which a personal site does in milliseconds and a site of many thousands would
 * not; the way out is a plain-text column kept beside `content_html` with a trigram index,
 * and only `published.ts` and this file would change.
 *
 * It is a substring, not a full-text search, because Thai is written without spaces between
 * words and a database's word splitter finds none in it.
 */
const MAX_CHARACTERS = 100;
const MAX_TERMS = 5;

/** The words of a search: cut to a hundred characters, split at any space or control character, at most five. */
export function searchTerms(input: string | undefined): string[] {
  // By code point, so the cut never leaves half of a pair, which would be searched for as a
  // replacement character and match nothing.
  const text = [...(input ?? '')].slice(0, MAX_CHARACTERS).join('');
  return text.split(/[\s\u0000-\u001f\u007f]+/u).filter(Boolean).slice(0, MAX_TERMS);
}

/** The search as the words that will be looked for, one space apart, or undefined when there are none. */
export function searchQuery(input: string | null | undefined): string | undefined {
  return searchTerms(input ?? undefined).join(' ') || undefined;
}

/** A LIKE pattern that finds `term` anywhere. The backslash is the escape, so `%` and `_` are only themselves. */
export function likeContaining(term: string): string {
  return `%${term.replace(/[\\%_]/g, '\\$&')}%`;
}
