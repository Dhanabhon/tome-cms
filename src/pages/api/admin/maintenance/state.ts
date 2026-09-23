import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';

import { maintenanceStateSchema } from '../../../../lib/site-maintenance';
import { assertSameOrigin } from '../../../../server/auth/origin';
import { requireInstalledOwner } from '../../../../server/auth/session';
import { setMaintenanceState } from '../../../../server/content/site-maintenance';
import { getServerEnv } from '../../../../server/env';
import { adminErrorResponse, HttpError } from '../../../../server/http/errors';
import { parseJson } from '../../../../server/http/json';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;

/** Opens or closes the site, and nothing else. */
export const PUT: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    try {
      assertSameOrigin(request, configuredOrigin);
    } catch {
      throw new HttpError(403, 'Request origin is not allowed.');
    }
    const { enabled } = await parseJson(request, maintenanceStateSchema);
    const maintenance = await setMaintenanceState(current.user.id, enabled);
    return Response.json({ maintenance }, {
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
    });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
