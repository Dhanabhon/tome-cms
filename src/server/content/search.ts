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
// What a box is turned into is the page's business too (the search box shows it), so it lives in lib.
export { searchQuery, searchTerms } from '../../lib/search-query';

/** A LIKE pattern that finds `term` anywhere. The backslash is the escape, so `%` and `_` are only themselves. */
export function likeContaining(term: string): string {
  return `%${term.replace(/[\\%_]/g, '\\$&')}%`;
}
