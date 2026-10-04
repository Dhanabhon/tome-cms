import { createHash } from 'node:crypto';

/**
 * The public page cache: a rendered page kept in this process's memory, so the next reader of the
 * same address is answered without the database.
 *
 * Fresh because every write clears it (the middleware after an admin write, MCP after its own) and
 * because nothing lives past five minutes or past the next scheduled post going public -- the one
 * change no write announces. A render that an invalidation overtook is not kept, or the old page
 * would come back after the edit. One process holds it, so there is nothing to keep in step.
 */
export const PAGE_CACHE_TTL_MS = 5 * 60_000;
export const PAGE_CACHE_MAX_BYTES = 32 * 1024 * 1024;
export const PAGE_CACHE_MAX_ENTRY_BYTES = 2 * 1024 * 1024;

const LOCALIZED_HOME = /^\/(?:th|en)\/?$/;
const LOCALIZED_POST = /^\/(?:th|en)\/blog\/[^/]+\/?$/;
const LOCALIZED_PAGE = /^\/(?:th|en)\/(?!blog(?:\/|$))[^/]+\/?$/;
const FEEDS = new Set(['/rss.xml', '/sitemap.xml', '/robots.txt']);
const KEPT_PARAMETERS = ['category', 'cursor'] as const;
const DROPPED_HEADERS = new Set(['set-cookie', 'date', 'content-length']);

interface Entry {
  body: Uint8Array<ArrayBuffer>;
  etag: string;
  expiresAt: number;
  headers: Array<[string, string]>;
}

let generation = 0;
let totalBytes = 0;
// A Map keeps insertion order, so re-inserting on every hit makes its first key the least recently used.
const entries = new Map<string, Entry>();

export function pageCacheKey(url: URL): string | null {
  const path = url.pathname;
  if (!(FEEDS.has(path) || LOCALIZED_HOME.test(path) || LOCALIZED_POST.test(path) || LOCALIZED_PAGE.test(path))) return null;
  if (url.searchParams.has('q')) return null;
  const kept = KEPT_PARAMETERS
    .map((name): [string, string] => [name, url.searchParams.get(name) ?? ''])
    .filter(([, value]) => value !== '');
  return kept.length === 0 ? path : `${path}?${new URLSearchParams(kept).toString()}`;
}

export function pageCacheGeneration(): number {
  return generation;
}

export function invalidatePageCache(): void {
  generation += 1;
  entries.clear();
  totalBytes = 0;
}

export function resetPageCacheForTest(): void {
  invalidatePageCache();
  generation = 0;
}

function drop(key: string): void {
  const entry = entries.get(key);
  if (!entry) return;
  totalBytes -= entry.body.byteLength;
  entries.delete(key);
}

function keep(key: string, entry: Entry): void {
  drop(key);
  entries.set(key, entry);
  totalBytes += entry.body.byteLength;
  for (const oldest of entries.keys()) {
    if (totalBytes <= PAGE_CACHE_MAX_BYTES) break;
    drop(oldest);
  }
}

function storable(response: Response): boolean {
  if (response.status !== 200 || response.headers.has('set-cookie')) return false;
  const control = response.headers.get('cache-control') ?? '';
  return !/\b(?:no-store|private)\b/i.test(control);
}

function answer(entry: Entry, request: Request, state: 'hit' | 'miss'): Response {
  const headers = new Headers(entry.headers);
  headers.set('ETag', entry.etag);
  headers.set('Cache-Control', 'no-cache');
  headers.set('X-Tome-Cache', state);
  if (request.headers.get('if-none-match') === entry.etag) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : entry.body, { status: 200, headers });
}

export async function servePublicPage(input: {
  request: Request;
  url: URL;
  bundled: boolean;
  render: () => Promise<Response>;
  nextScheduled: () => Promise<Date | null>;
  now?: () => number;
}): Promise<Response> {
  const { request } = input;
  const now = input.now ?? Date.now;
  const key = input.bundled && (request.method === 'GET' || request.method === 'HEAD') ? pageCacheKey(input.url) : null;
  if (!key) return input.render();

  const known = entries.get(key);
  if (known && known.expiresAt > now()) {
    keep(key, known);
    return answer(known, request, 'hit');
  }
  if (known) drop(key);

  const started = generation;
  const response = await input.render();
  if (!storable(response)) return response;

  const body = new Uint8Array(await response.arrayBuffer());
  const headers = [...response.headers].filter(([name]) => !DROPPED_HEADERS.has(name.toLowerCase()));
  const scheduled = await input.nextScheduled();
  const entry: Entry = {
    body,
    etag: `"${createHash('sha256').update(body).digest('hex')}"`,
    expiresAt: Math.min(now() + PAGE_CACHE_TTL_MS, scheduled ? scheduled.getTime() : Number.POSITIVE_INFINITY),
    headers,
  };
  // An edit landed while this page was being drawn: what it drew may be the old version.
  if (generation === started && body.byteLength <= PAGE_CACHE_MAX_ENTRY_BYTES) keep(key, entry);
  return answer(entry, request, 'miss');
}
