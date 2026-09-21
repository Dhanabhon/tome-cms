/**
 * A bounded line of prose that ends where prose ends.
 *
 * It was `slice(0, 157)`, which cuts wherever the 157th code unit happens to fall. In
 * English that lands mid-word often enough to look careless. In Thai it lands mid-word
 * almost always, because Thai is written without spaces between words -- there is no gap
 * for a blind cut to find, and `trimEnd()` had nothing to trim, so the ellipsis was glued
 * to half a syllable.
 *
 * Whole sentences first. When even the first sentence is longer than the room -- the usual
 * case for a Thai paragraph -- whole words, which ICU knows the ends of and a count of code
 * units does not.
 */
export function summaryText(text: string, locale: string, limit = 160): string {
  if (text.length <= limit) return text;
  // The ellipsis is a character of the answer, not an addition to it.
  const room = limit - 1;
  const upTo = (granularity: 'sentence' | 'word') => {
    let taken = '';
    for (const { segment } of new Intl.Segmenter(locale, { granularity }).segment(text)) {
      if (taken.length + segment.length > room) break;
      taken += segment;
    }
    return taken.trimEnd();
  };
  // A single word longer than the whole allowance is not prose; cut it and move on.
  const whole = upTo('sentence') || upTo('word') || text.slice(0, room).trimEnd();
  return `${whole}…`;
}
