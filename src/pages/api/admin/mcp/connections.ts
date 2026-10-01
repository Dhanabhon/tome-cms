import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';
import { z } from 'zod';

import { assertSameOrigin } from '../../../../server/auth/origin';
import { requireInstalledOwner } from '../../../../server/auth/session';
import { getServerEnv } from '../../../../server/env';
import { adminErrorResponse, HttpError } from '../../../../server/http/errors';
import { parseJson } from '../../../../server/http/json';
import { mcpConfig } from '../../../../server/mcp/config';
import { listConnections, revokeConnection } from '../../../../server/mcp/connections';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;
const revokeSchema = z.object({ id: z.string().min(1).max(100) }).strict();
const headers = (requestId: string) => ({ 'Cache-Control': 'no-store', 'X-Request-ID': requestId });

/** Both routes are a 404 while MCP is off, like everything else it serves. */
async function ownerConfig(request: Request) {
  const current = await requireInstalledOwner(request.headers);
  const config = await mcpConfig();
  if (!config) throw new HttpError(404, 'MCP is switched off.');
  return { config, current };
}

export const GET: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const { current } = await ownerConfig(request);
    return Response.json({ connections: await listConnections(current.user.id) }, { headers: headers(requestId) });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const { current } = await ownerConfig(request);
    try {
      assertSameOrigin(request, configuredOrigin);
    } catch {
      throw new HttpError(403, 'Request origin is not allowed.');
    }
    const { id } = await parseJson(request, revokeSchema);
    await revokeConnection(current.user.id, id);
    return Response.json({ ok: true }, { headers: headers(requestId) });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
