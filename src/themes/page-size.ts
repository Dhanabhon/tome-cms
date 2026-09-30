/**
 * How many posts the home page asks for.
 *
 * A theme that sets its newest post apart from its grid (`leadsFirstPage`) needs one more on
 * the first page of an unsearched list, so the grid under the lead still ends on a full row.
 * Every other page, a search included, is the normal size.
 */
export function homePageLimit({ cursor, leadsFirstPage, pageSize, query }: {
  cursor: string | undefined;
  leadsFirstPage: boolean | undefined;
  pageSize: number;
  query: string | undefined;
}): number {
  return leadsFirstPage && !cursor && !query ? pageSize + 1 : pageSize;
}
