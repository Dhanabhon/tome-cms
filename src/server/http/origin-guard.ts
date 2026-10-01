/**
 * Astro's own cross-site form check, done again with the site's public origin.
 *
 * Astro compares `Origin` with the URL the app sees, which behind Caddy is http:// while the
 * browser says https://; and it refuses a form post that carries no `Origin`, which is exactly how
 * an OAuth client's server calls the token endpoint. So Astro's check is off (astro.config) and this
 * one runs first in the middleware. JSON is not a form a page can send across sites without CORS,
 * so it is left to the routes, which each call assertSameOrigin.
 */
const FORM_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Called by other servers, never by a page with the owner's cookie: each authenticates itself. */
export const ORIGIN_EXEMPT_PATHS: ReadonlySet<string> = new Set(['/oauth/token', '/oauth/register', '/mcp']);

export function crossSiteRefusal(request: Request, publicOrigin: string): Response | null {
  if (SAFE_METHODS.has(request.method)) return null;
  const url = new URL(request.url);
  if (ORIGIN_EXEMPT_PATHS.has(url.pathname.replace(/\/$/, ''))) return null;
  const origin = request.headers.get('origin');
  if (origin === publicOrigin || origin === url.origin) return null;
  const type = request.headers.get('content-type');
  if (type !== null && !FORM_TYPES.some((form) => type.toLowerCase().includes(form))) return null;
  return new Response(`Cross-site ${request.method} form submissions are forbidden`, { status: 403 });
}
