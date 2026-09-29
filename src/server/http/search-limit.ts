import { HttpError } from './errors';
import { createRateLimit } from '../stats/rules';
import { rateLimitKey, senderAddress } from './sender-address';

// A search reads every published post of a language, which makes it the one public read that
// costs the server real work. A reader searches a few times a minute; a sender that does it
// once a second for a minute is a script, and on a one-core server a script can hold the
// database busy.
//
// ponytail: one process's memory, as the limit on counting readers is. TomeCMS runs one
// application process, and a restart forgets the counts, which costs an attacker nothing they
// would not have had a minute later.
const limit = createRateLimit({ capacity: 5_000, limit: 60, windowMs: 60_000 });

/** Counts a search by this sender, and says whether it may go ahead. */
export function maySearch(request: Request, clientAddress: string): boolean {
  return limit.allow(rateLimitKey(senderAddress(request, clientAddress)));
}

// The limit above is per sender, and many senders at once are still one database with a handful
// of connections that the admin and sign-in share. Two searches run at a time; a third is told
// to come back rather than queued, because a queue of searches is the thing being avoided.
const AT_ONCE = 2;
let running = 0;

/** Runs a search if one of the places is free, and gives the place back when it ends, however it ends. */
export async function whileSearching<T>(search: () => Promise<T>): Promise<T> {
  if (running >= AT_ONCE) throw new HttpError(429, 'Search is busy. Try again in a moment.');
  running += 1;
  try {
    return await search();
  } finally {
    running -= 1;
  }
}
