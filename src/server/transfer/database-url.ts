/**
 * A DATABASE_URL split for libpq tools (pg_dump, pg_restore): the password leaves the URL,
 * wherever it was, so it can travel in PGPASSWORD instead of argv. The options only the app's own
 * pool reads (src/server/db/client.ts) go too, because libpq refuses a URI that carries them.
 *
 * Shared by scripts/backup.ts, which runs from source in the image, so it imports nothing.
 */
const POOL_OPTIONS = new Set(['query_timeout', 'statement_timeout', 'connectionTimeoutMillis']);

export function splitDatabaseUrl(databaseUrl: string): { url: string; password: string } {
  const url = new URL(databaseUrl);
  let queryPassword = '';
  const query = url.search.slice(1).split('&').filter((pair) => {
    const separator = pair.indexOf('=');
    const key = decodeURIComponent(pair.slice(0, separator < 0 ? pair.length : separator).replace(/\+/g, ' '));
    if (POOL_OPTIONS.has(key)) return false;
    if (key !== 'password') return true;
    queryPassword = decodeURIComponent((separator < 0 ? '' : pair.slice(separator + 1)).replace(/\+/g, ' '));
    return false;
  }).join('&');
  const password = queryPassword || decodeURIComponent(url.password);
  url.search = query ? `?${query}` : '';
  url.password = '';
  return { url: url.href, password };
}
