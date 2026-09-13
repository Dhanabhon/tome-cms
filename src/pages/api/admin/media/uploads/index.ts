import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';

import { assertSameOrigin } from '../../../../../server/auth/origin';
import { requireInstalledOwner } from '../../../../../server/auth/session';
import { getServerEnv } from '../../../../../server/env';
import { adminErrorResponse, HttpError } from '../../../../../server/http/errors';
import { parseJson } from '../../../../../server/http/json';
import { reserveUpload, reserveUploadSchema } from '../../../../../server/media/service';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;

export const POST: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    try {
      assertSameOrigin(request, configuredOrigin);
    } catch {
      throw new HttpError(403, 'Request origin is not allowed.');
    }
    const input = await parseJson(request, reserveUploadSchema);
    return Response.json({ reservation: await reserveUpload(current.user.id, input) }, {
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
      status: 201,
    });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
