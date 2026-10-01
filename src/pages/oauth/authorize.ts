import type { APIRoute } from 'astro';

import { normalizeAdminPath } from '../../lib/admin';
import { adminCopy } from '../../lib/admin-i18n';
import { enforceRateLimit, RateLimitExceededError } from '../../server/auth/rate-limit';
import { getSiteSettings } from '../../server/content/site-settings';
import { senderAddress } from '../../server/http/sender-address';
import { mcpConfig, notFound } from '../../server/mcp/config';
import { OAuthPageError, startAuthorization } from '../../server/mcp/oauth';

/** The page for a request that goes nowhere. Fixed copy only: nothing from the request is written into it. */
async function invalidRequestPage(status: 400 | 429, headers: Record<string, string> = {}): Promise<Response> {
  const locale = (await getSiteSettings())?.default_locale ?? 'en';
  const copy = adminCopy(locale).mcp;
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${copy.invalidRequestTitle}</title></head><body><main><h1>${copy.invalidRequestTitle}</h1><p>${copy.invalidRequestBody}</p></main></body></html>`;
  return new Response(html, { headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8', ...headers }, status });
}

/**
 * Where an AI app sends the owner's browser. The request is checked in full first; only a good one
 * goes on to the consent screen (which signs the owner in if needed), and a bad one is a page that
 * redirects nowhere, since its redirect URI is exactly what cannot be trusted. GET only: the answer
 * is posted from the consent screen to /api/admin/mcp/consent.
 *
 * Anyone can call this, and a call can make the site fetch a client's document, so it is counted
 * per sender like the other OAuth endpoints.
 */
export const GET: APIRoute = async ({ request, url, clientAddress }) => {
  const config = await mcpConfig();
  if (!config) return notFound();
  try {
    await enforceRateLimit('oauth-authorize', senderAddress(request, clientAddress));
  } catch (error) {
    if (!(error instanceof RateLimitExceededError)) throw error;
    return invalidRequestPage(429, { 'Retry-After': String(error.retryAfter) });
  }
  try {
    const { requestId } = await startAuthorization(config, url.searchParams);
    return new Response(null, {
      headers: { 'Cache-Control': 'no-store', Location: `${normalizeAdminPath(config.adminPath)}/connect?request=${requestId}` },
      status: 302,
    });
  } catch (error) {
    if (!(error instanceof OAuthPageError)) throw error;
    return invalidRequestPage(400);
  }
};
