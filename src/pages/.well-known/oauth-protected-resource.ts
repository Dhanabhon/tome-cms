import type { APIRoute } from 'astro';

import { mcpConfig, notFound } from '../../server/mcp/config';
import { SCOPES } from '../../server/mcp/oauth';

/** RFC 9728: where a client that got a 401 from /mcp learns who issues tokens for it. */
export const GET: APIRoute = async () => {
  const config = await mcpConfig();
  if (!config) return notFound();
  return Response.json({
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: SCOPES,
    bearer_methods_supported: ['header'],
  });
};
