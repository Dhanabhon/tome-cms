/**
 * HSTS: a browser that has been here once over HTTPS goes straight to HTTPS for a year, so the one
 * request a redirect cannot protect -- the first, typed as http:// -- never leaves the browser.
 *
 * Sent by the app, not by the Caddyfile prepare-vps.sh writes, so every install gets it from an
 * update. No includeSubDomains (the owner's other names are not ours to force) and no preload (it
 * cannot be undone quickly). Only for an https: public URL; browsers ignore it over plain HTTP anyway.
 */
export const STRICT_TRANSPORT = 'max-age=31536000';

/** A missing or unparsable URL leaves the response alone: some routes answer before runtime configuration is loaded. */
export function withStrictTransport(response: Response, publicUrl: string | undefined): Response {
  if (!publicUrl || !URL.canParse(publicUrl)) return response;
  if (new URL(publicUrl).protocol !== 'https:' || response.headers.has('strict-transport-security')) return response;
  try {
    response.headers.set('Strict-Transport-Security', STRICT_TRANSPORT);
    return response;
  } catch {
    // A redirect's headers are immutable; a copy takes the header.
    const copy = new Response(response.body, response);
    copy.headers.set('Strict-Transport-Security', STRICT_TRANSPORT);
    return copy;
  }
}
