/**
 * What a reader's page and the server agree on about counting.
 *
 * No imports: the script that reads this ships on every public page, and anything this file
 * pulled in would ship with it.
 */

export const STATS_ENDPOINT = '/api/v1/stats/hit';

/** Set by every signed-in admin page in that browser; the reader's script sends nothing while it is there. */
export const STATS_OWNER_KEY = 'tomecms:stats-owner';

/** Seconds the tab must have been visible, in all, before reaching the end counts as a read. */
export const READ_AFTER_SECONDS = 15;

/** What a public page is, for counting: the home page, or one edition by its id. */
export type CountedPage = { kind: 'home' } | { id: string; kind: 'page' | 'post' };
