/** What an excerpt may hold -- the same bound the field and the table keep. */
export const EXCERPT_LENGTH = 120;
/** Shorter than this is a fragment, not something a reader could decide on. */
const SHORTEST = 20;
/** Enough choice to find a good one; few enough that a request stays small. */
const MOST = 60;

const THAI = /\p{Script=Thai}/u;
/** Mai yamok and paiyannoi carry on the word before them; a space in front of one is not a break. */
const CONTINUES = /^[ๆฯ]/u;

/**
 * Where a Thai sentence ends.
 *
 * Not where ICU says: Thai has no full stop, so ICU's sentence break reads a whole Thai
 * paragraph as one sentence -- measured, three hundred characters in a single segment. Thai
 * puts a space where English puts a stop, so a space with Thai on both sides is the break.
 * Not every space is one: `จริง ๆ` is one word written with a space, and an English term set
 * into Thai text -- `การทำ Intermittent Fasting ที่` -- is part of the clause around it.
 */
function clauses(sentence: string): string[] {
  const found: string[] = [];
  let current = '';
  for (const part of sentence.split(' ').filter(Boolean)) {
    const breaks = current !== ''
      && THAI.test(current.at(-1) ?? '') && THAI.test(part[0] ?? '') && !CONTINUES.test(part);
    if (breaks) {
      found.push(current);
      current = part;
    } else {
      current = current ? `${current} ${part}` : part;
    }
  }
  if (current) found.push(current);
  return found;
}

/**
 * The passages an excerpt could be, each copied from the article exactly.
 *
 * Found by code and chosen by a judgement, the way TypeSafe's value-extraction cookbook does
 * it: over-find here, and let the choice be the filter. Every candidate is a run of whole
 * sentences or clauses from the text as written, so whichever one is chosen is words the
 * owner wrote, in the order they wrote them -- nothing can be paraphrased into a card, and
 * nothing invented can reach the page's description.
 *
 * Runs of one to three, because the best summary is often two short sentences together;
 * bounded by what the excerpt field can hold; deduplicated, in the order they appear.
 */
export function excerptCandidates(text: string, locale: string): string[] {
  const prose = text.replace(/\s+/g, ' ').trim();
  if (!prose) return [];
  const units = [...new Intl.Segmenter(locale, { granularity: 'sentence' }).segment(prose)]
    .flatMap(({ segment }) => clauses(segment.trim()));

  const seen = new Set<string>();
  const candidates: string[] = [];
  for (let start = 0; start < units.length && candidates.length < MOST; start += 1) {
    for (let length = 1; length <= 3 && start + length <= units.length; length += 1) {
      const passage = units.slice(start, start + length).join(' ');
      if (passage.length > EXCERPT_LENGTH) break;
      if (passage.length < SHORTEST || seen.has(passage)) continue;
      seen.add(passage);
      candidates.push(passage);
    }
  }
  return candidates;
}
