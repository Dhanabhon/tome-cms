import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';

import { maintenanceSchema } from '../../../../lib/site-maintenance';
import { assertSameOrigin } from '../../../../server/auth/origin';
import { requireInstalledOwner } from '../../../../server/auth/session';
import { readMaintenance, saveMaintenance } from '../../../../server/content/site-maintenance';
import { getServerEnv } from '../../../../server/env';
import { adminErrorResponse, HttpError } from '../../../../server/http/errors';
import { parseJson } from '../../../../server/http/json';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;

function guardOrigin(request: Request): void {
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
    guardOrigin(request);
    return Response.json(await readMaintenance(current.user.id), {
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
    });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};

/** The page alone. The switch has a route of its own, so saving never closes the site. */
export const PUT: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    guardOrigin(request);
    const input = await parseJson(request, maintenanceSchema);
    const maintenance = await saveMaintenance(current.user.id, input);
    return Response.json({ maintenance }, {
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
    });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
