import { createMcpHandler, originValidationResponse } from '@modelcontextprotocol/server';
import type { APIRoute } from 'astro';

import { mcpConfig, notFound } from '../server/mcp/config';
import { verifyAccessToken } from '../server/mcp/oauth';
import { buildMcpServer } from '../server/mcp/tools';

/**
 * The MCP endpoint: a bearer token and nothing else (never the owner's cookie), a fresh server per
 * request whose tools are the token's, and 401 with the metadata pointer so a client knows where
 * to sign in.
 */
const handle: APIRoute = async ({ request }) => {
  const config = await mcpConfig();
  if (!config) return notFound();
  const badOrigin = originValidationResponse(request, [new URL(config.issuer).hostname]);
  if (badOrigin) return badOrigin;
  const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization') ?? '')?.[1];
  const token = bearer ? await verifyAccessToken(config, bearer) : null;
  if (!bearer || !token) {
    return new Response(null, { status: 401, headers: {
      'Cache-Control': 'no-store',
      'WWW-Authenticate': `Bearer resource_metadata="${config.issuer}/.well-known/oauth-protected-resource"`,
    } });
  }
  const handler = createMcpHandler(() => buildMcpServer(config, token));
  return handler.fetch(request, { authInfo: { token: bearer, clientId: token.connectionId, scopes: token.scopes, expiresAt: token.expiresAt, resource: new URL(config.resource) } });
};

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
