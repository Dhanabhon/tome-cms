import type { APIRoute } from 'astro';

import { mcpConfig, notFound } from '../../server/mcp/config';
import { SCOPES } from '../../server/mcp/oauth';

/** RFC 8414: the site is its own authorization server, for MCP clients only. */
export const GET: APIRoute = async () => {
  const config = await mcpConfig();
  if (!config) return notFound();
  return Response.json({
    issuer: config.issuer,
    authorization_endpoint: `${config.issuer}/oauth/authorize`,
    token_endpoint: `${config.issuer}/oauth/token`,
    registration_endpoint: `${config.issuer}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    client_id_metadata_document_supported: true,
    // ChatGPT uses its stable callback only when the issuer comes back with the code.
    authorization_response_iss_parameter_supported: true,
    scopes_supported: SCOPES,
  });
};
