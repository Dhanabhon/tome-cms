import type { APIRoute } from 'astro';
import { z } from 'zod';

import { enforceRateLimit, RateLimitExceededError } from '../../server/auth/rate-limit';
import { HttpError } from '../../server/http/errors';
import { parseJson } from '../../server/http/json';
import { senderAddress } from '../../server/http/sender-address';
import { mcpConfig, notFound } from '../../server/mcp/config';
import { OAuthRegistrationError, registerClient } from '../../server/mcp/oauth';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * DCR (RFC 7591), called by an AI app's server: no Origin, no cookie, and nothing read from one.
 * Anyone may register; a client is worth nothing until the owner approves it with a passkey.
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  const config = await mcpConfig();
  if (!config) return notFound();
  try {
    await enforceRateLimit('oauth-register', senderAddress(request, clientAddress));
    const client = await registerClient(config, await parseJson(request, z.unknown()));
    return Response.json({
      ...client,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }, { headers: NO_STORE, status: 201 });
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return Response.json({ error: 'too_many_requests' }, { headers: { ...NO_STORE, 'Retry-After': String(error.retryAfter) }, status: 429 });
    }
    if (error instanceof OAuthRegistrationError) {
      return Response.json({ error: error.code, error_description: error.message }, { headers: NO_STORE, status: 400 });
    }
    if (error instanceof HttpError) return Response.json({ error: 'invalid_client_metadata' }, { headers: NO_STORE, status: 400 });
    throw error;
  }
};
