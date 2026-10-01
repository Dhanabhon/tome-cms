import type { APIRoute } from 'astro';

import { enforceRateLimit, RateLimitExceededError } from '../../server/auth/rate-limit';
import { senderAddress } from '../../server/http/sender-address';
import { mcpConfig, notFound } from '../../server/mcp/config';
import { exchange, OAuthTokenError } from '../../server/mcp/oauth';

const HEADERS = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };
const MAX_FORM_BYTES = 16 * 1024;

/**
 * The token endpoint, called by an AI app's server with a form (RFC 6749 3.2). The origin guard
 * lets it through without an Origin; what it trusts is the code with its verifier, or a refresh
 * token -- never the owner's cookie, which is not read here.
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  const config = await mcpConfig();
  if (!config) return notFound();
  try {
    await enforceRateLimit('oauth-token', senderAddress(request, clientAddress));
  } catch (error) {
    if (!(error instanceof RateLimitExceededError)) throw error;
    return Response.json({ error: 'too_many_requests' }, { headers: { ...HEADERS, 'Retry-After': String(error.retryAfter) }, status: 429 });
  }
  const type = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  const body = type === 'application/x-www-form-urlencoded' ? await request.text() : null;
  if (body === null || body.length > MAX_FORM_BYTES) return Response.json({ error: 'invalid_request' }, { headers: HEADERS, status: 400 });
  try {
    return Response.json(await exchange(config, new URLSearchParams(body)), { headers: HEADERS });
  } catch (error) {
    if (!(error instanceof OAuthTokenError)) throw error;
    return Response.json({ error: error.code }, { headers: HEADERS, status: error.status });
  }
};
