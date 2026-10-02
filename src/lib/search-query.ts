/**
 * What a reader typed into a search box, as the words to look for. The server searches by these
 * words, and a theme shows them back in its box, so both read them the same way.
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
