import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Reads remembered for the length of one request, and no longer.
 *
 * A public page asked for the site's settings six times and each plugin's settings once apiece:
 * sixteen queries for a home page, most of them the same one, and on a one-core server every
 * query is CPU the database and the application both spend. Nothing is kept past the request, so
 * an edit is seen by the next one and there is nothing to invalidate. The middleware opens a scope
 * for reads only (GET and HEAD), where nothing in the request writes what it read.
 *
 * Callers share what was read, so it is theirs to read, never to change.
 */
const scope = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

export function withRequestMemo<T>(run: () => Promise<T>): Promise<T> {
  return scope.run(new Map(), run);
}

export function memoForRequest<T>(key: string, load: () => Promise<T>): Promise<T> {
  const store = scope.getStore();
  if (!store) return load();
  const known = store.get(key) as Promise<T> | undefined;
  if (known) return known;
  const pending = load();
  store.set(key, pending);
  // A read that failed is not remembered: the next caller in the request tries again.
  pending.catch(() => store.delete(key));
  return pending;
}
