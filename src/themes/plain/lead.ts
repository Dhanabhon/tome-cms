/** The newest post leads the front page: the first page of a list nobody searched, when it has a post. */
export const leadsWith = ({ cursor, posts, query }: { cursor: string | undefined; posts: number; query: string | undefined }) =>
  !cursor && !query && posts > 0;
