import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';

import { assertSameOrigin } from '../../../../server/auth/origin';
import { enforceRateLimit, RateLimitExceededError } from '../../../../server/auth/rate-limit';
import { requireInstalledOwner } from '../../../../server/auth/session';
import { getServerEnv } from '../../../../server/env';
import { adminErrorResponse, HttpError } from '../../../../server/http/errors';
import { parseJson } from '../../../../server/http/json';
import { getUpdateInstallability, updateActionSchema } from '../../../../server/update/admin';
import { getUpdateStatus, refreshUpdateStatus } from '../../../../server/update/service';

const environment = getServerEnv();
const configuredOrigin = new URL(environment.TOME_CMS_PUBLIC_URL).origin;

const headers = (requestId: string) => ({ 'Cache-Control': 'no-store', 'X-Request-ID': requestId });
const response = async (status: ReturnType<typeof getUpdateStatus>) => ({
  ...(await status),
  updateMode: environment.TOME_CMS_UPDATE_MODE,
  installability: getUpdateInstallability(environment.TOME_CMS_UPDATE_MODE),
});

export const GET: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    await requireInstalledOwner(request.headers);
    return Response.json(await response(getUpdateStatus()), { headers: headers(requestId) });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};

export const POST: APIRoute = async ({ clientAddress, request }) => {
  const requestId = randomUUID();
  try {
    await requireInstalledOwner(request.headers);
    try {
      assertSameOrigin(request, configuredOrigin);
    } catch {
      throw new HttpError(403, 'Request origin is not allowed.');
    }
    await enforceRateLimit('update-check', clientAddress);
    const action = await parseJson(request, updateActionSchema);
    if (action.action === 'check') return Response.json(await response(refreshUpdateStatus()), { headers: headers(requestId) });
    throw new HttpError(409, 'Managed updates are not available on this installation.');
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return Response.json({ error: error.message, requestId }, {
        headers: { ...headers(requestId), 'Retry-After': String(error.retryAfter) }, status: 429,
      });
    }
    return adminErrorResponse(error, requestId);
  }
};
