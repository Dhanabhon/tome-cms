import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';

import { requireFreshOwnerSession } from '../../../../server/auth/fresh-session';
import { assertSameOrigin } from '../../../../server/auth/origin';
import { enforceRateLimit, RateLimitExceededError } from '../../../../server/auth/rate-limit';
import { requireInstalledOwner } from '../../../../server/auth/session';
import { getServerEnv } from '../../../../server/env';
import { adminErrorResponse, HttpError } from '../../../../server/http/errors';
import { parseJson } from '../../../../server/http/json';
import { getUpdateInstallability, updateActionSchema } from '../../../../server/update/admin';
import { getUpdateStatus, refreshUpdateStatus } from '../../../../server/update/service';
import { readMaintenanceStatus } from '../../../../server/update/maintenance';
import { getManagedInstallability, getUpdaterStatus, requestUpdate, type UpdaterStatus } from '../../../../server/update/updater-client';

const environment = getServerEnv();
const configuredOrigin = new URL(environment.TOME_CMS_PUBLIC_URL).origin;

const headers = (requestId: string) => ({ 'Cache-Control': 'no-store', 'X-Request-ID': requestId });
async function managedStatus(): Promise<UpdaterStatus> {
  if (environment.TOME_CMS_UPDATE_MODE !== 'managed') return { managed: false };
  const [updater, maintenance] = await Promise.all([
    getUpdaterStatus({ socketPath: environment.TOME_CMS_UPDATER_SOCKET }), readMaintenanceStatus(),
  ]);
  return maintenance.managed ? updater : { managed: false };
}

async function response(status: ReturnType<typeof getUpdateStatus>) {
  const [check, updater] = await Promise.all([status, managedStatus()]);
  return {
    ...check, updateMode: environment.TOME_CMS_UPDATE_MODE, updater,
    installability: environment.TOME_CMS_UPDATE_MODE === 'check-only'
      ? getUpdateInstallability('check-only') : getManagedInstallability(check, updater),
  };
}

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
    try {
      assertSameOrigin(request, configuredOrigin);
    } catch {
      throw new HttpError(403, 'Request origin is not allowed.');
    }
    const current = await requireInstalledOwner(request.headers);
    const action = await parseJson(request, updateActionSchema);
    if (action.action === 'check') {
      await enforceRateLimit('update-check', clientAddress);
      return Response.json(await response(refreshUpdateStatus()), { headers: headers(requestId) });
    }
    await enforceRateLimit('update-apply', clientAddress);
    await requireFreshOwnerSession(current);
    const check = await getUpdateStatus();
    if (check.latest?.manifest.version !== action.version) throw new HttpError(409, 'The latest update has changed. Check again.');
    const updater = await managedStatus();
    const capability = getManagedInstallability(check, updater);
    if (!capability.installable) throw new HttpError(409, capability.reason);
    const result = await requestUpdate({ socketPath: environment.TOME_CMS_UPDATER_SOCKET, version: action.version, requestId });
    return Response.json({ ...result, requestId }, {
      status: result.outcome === 'accepted' ? 202 : 200,
      headers: headers(requestId),
    });
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return Response.json({ error: error.message, requestId }, {
        headers: { ...headers(requestId), 'Retry-After': String(error.retryAfter) }, status: 429,
      });
    }
    return adminErrorResponse(error, requestId);
  }
};
