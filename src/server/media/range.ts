/**
 * What a Range header asks for. Storage answers the range itself, so this only tells a header it
 * can pass on from one that has to be refused: a single `bytes` range, `a-b`, `a-` or `-n`, in order.
 * Several ranges are refused too: a reader that wants a PDF's pages asks one range at a time.
 */
export function checkRange(header: string | null): 'malformed' | 'range' | 'whole' {
  if (header === null) return 'whole';
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match) return 'malformed';
  const [, first, last] = match;
  if (!first && !last) return 'malformed';
  if (!first) return Number(last) > 0 ? 'range' : 'malformed';
  return last && Number(last) < Number(first) ? 'malformed' : 'range';
}
