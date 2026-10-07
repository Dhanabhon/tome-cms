/**
 * Where a list's own scroll goes to keep row `index` in sight: the nearest edge that shows it,
 * except that the first and last rows go to the list's very start and end, so its padding shows.
 */
export function scrollTargetFor(
  list: { clientHeight: number; scrollHeight: number; scrollTop: number },
  row: { offsetHeight: number; offsetTop: number },
  index: number,
  count: number,
): number {
  if (index === 0) return 0;
  if (index === count - 1) return Math.max(0, list.scrollHeight - list.clientHeight);
  if (row.offsetTop < list.scrollTop) return row.offsetTop;
  const bottom = row.offsetTop + row.offsetHeight;
  return bottom > list.scrollTop + list.clientHeight ? bottom - list.clientHeight : list.scrollTop;
}
