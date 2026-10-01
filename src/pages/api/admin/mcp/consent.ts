import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';
import { z } from 'zod';

import { requireFreshOwnerSession } from '../../../../server/auth/fresh-session';
import { assertSameOrigin } from '../../../../server/auth/origin';
import { requireInstalledOwner } from '../../../../server/auth/session';
import { getServerEnv } from '../../../../server/env';
import { adminErrorResponse, HttpError } from '../../../../server/http/errors';
import { parseJson } from '../../../../server/http/json';
import { mcpConfig } from '../../../../server/mcp/config';
import { decide, OAuthPageError } from '../../../../server/mcp/oauth';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;

const consentSchema = z.object({ request: z.string().min(1).max(100), allow: z.boolean(), write: z.boolean() }).strict();

/**
 * The owner's answer to an AI app. Allowing needs a passkey from the last five minutes, as
 * installing an update does: a cookie alone is not enough to hand the site to another program.
 */
export const POST: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    try {
      assertSameOrigin(request, configuredOrigin);
    } catch {
      throw new HttpError(403, 'Request origin is not allowed.');
    }
    const config = await mcpConfig();
    if (!config) throw new HttpError(404, 'MCP is switched off.');
    const answer = await parseJson(request, consentSchema);
    if (answer.allow) await requireFreshOwnerSession(current);
    try {
      const { redirect } = await decide(config, current.user.id, answer.request, { allow: answer.allow, write: answer.write });
      return Response.json({ redirect }, { headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId } });
    } catch (error) {
      if (error instanceof OAuthPageError) throw new HttpError(400, error.message, { code: 'mcp_request_invalid' });
      throw error;
    }
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
