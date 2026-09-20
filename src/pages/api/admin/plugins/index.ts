import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';
import { z } from 'zod';

import { assertSameOrigin } from '../../../../server/auth/origin';
import { requireInstalledOwner } from '../../../../server/auth/session';
import { getServerEnv } from '../../../../server/env';
import { adminErrorResponse, HttpError } from '../../../../server/http/errors';
import { parseJson } from '../../../../server/http/json';
import { readPluginStates, writePluginSettings } from '../../../../server/plugins/store';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;

/**
 * Values are read as strings and bounded here, not by each setting's own type, because a
 * plugin's fields are the plugin's business and the request is still the product's. What a
 * key means is checked against the manifest where it is written.
 */
const mutationSchema = z.object({
  enabled: z.boolean(),
  id: z.string().min(1).max(64),
  values: z.record(z.string().min(1).max(64), z.string().max(2_048)),
}).strict();

function sameOrigin(request: Request): void {
  try {
    assertSameOrigin(request, configuredOrigin);
  } catch {
    throw new HttpError(403, 'Request origin is not allowed.');
  }
}

export const GET: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    return Response.json({ plugins: await readPluginStates(current.user.id) }, {
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
    });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};

export const PUT: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    sameOrigin(request);
    const input = await parseJson(request, mutationSchema);
    await writePluginSettings(current.user.id, input);
    // Answered with the state the admin may see, so a secret just written is reported as
    // set and never sent back.
    return Response.json({ plugins: await readPluginStates(current.user.id) }, {
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
    });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
