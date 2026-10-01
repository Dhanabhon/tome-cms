import type { APIRoute } from 'astro';

import { normalizeAdminPath } from '../../lib/admin';
import { adminCopy } from '../../lib/admin-i18n';
import { getSiteSettings } from '../../server/content/site-settings';
import { mcpConfig, notFound } from '../../server/mcp/config';
import { OAuthPageError, startAuthorization } from '../../server/mcp/oauth';

/**
 * Where an AI app sends the owner's browser. The request is checked in full first; only a good one
 * goes on to the consent screen (which signs the owner in if needed), and a bad one is a page that
 * redirects nowhere, since its redirect URI is exactly what cannot be trusted. GET only: the answer
 * is posted from the consent screen to /api/admin/mcp/consent.
 */
export const GET: APIRoute = async ({ url }) => {
  const config = await mcpConfig();
  if (!config) return notFound();
  try {
    const { requestId } = await startAuthorization(config, url.searchParams);
    return new Response(null, {
      headers: { 'Cache-Control': 'no-store', Location: `${normalizeAdminPath(config.adminPath)}/connect?request=${requestId}` },
      status: 302,
    });
  } catch (error) {
    if (!(error instanceof OAuthPageError)) throw error;
    const locale = (await getSiteSettings())?.default_locale ?? 'en';
    const copy = adminCopy(locale).mcp;
    // Fixed copy only: nothing from the request is written into the page.
    const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${copy.invalidRequestTitle}</title></head><body><main><h1>${copy.invalidRequestTitle}</h1><p>${copy.invalidRequestBody}</p></main></body></html>`;
    return new Response(html, { headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' }, status: 400 });
  }
};
