import { db } from '../db/client';

export interface AdminStoryCounts {
  pages: number;
  posts: number;
}

/**
 * How many posts and pages the owner has, for the admin sidebar. A story written in two
 * languages is one card or one row on its list, so it counts once here, and the numbers
 * match each list's "All" tab.
 */
export async function countAdminStories(ownerId: string): Promise<AdminStoryCounts> {
  const [posts, pages] = await Promise.all([
    db.selectFrom('posts')
      .select((eb) => eb.fn.count<string>('translation_group_id').distinct().as('count'))
      .where('owner_id', '=', ownerId)
      .executeTakeFirstOrThrow(),
    db.selectFrom('pages')
      .select((eb) => eb.fn.count<string>('translation_group_id').distinct().as('count'))
      .where('owner_id', '=', ownerId)
      .executeTakeFirstOrThrow(),
  ]);
  return { pages: Number(pages.count), posts: Number(posts.count) };
}
