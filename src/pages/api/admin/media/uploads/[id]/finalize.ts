import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';
import { z } from 'zod';

import { assertSameOrigin } from '../../../../../../server/auth/origin';
import { requireInstalledOwner } from '../../../../../../server/auth/session';
import { getServerEnv } from '../../../../../../server/env';
import { adminErrorResponse, HttpError } from '../../../../../../server/http/errors';
import { parseJson } from '../../../../../../server/http/json';
import { finalizeUpload, finalizeUploadSchema } from '../../../../../../server/media/service';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;

export const POST: APIRoute = async ({ params, request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    try {
      assertSameOrigin(request, configuredOrigin);
    } catch {
      throw new HttpError(403, 'Request origin is not allowed.');
    }
    await parseJson(request, finalizeUploadSchema);
    const reservationId = z.uuid().parse(params.id);
    return Response.json({ item: await finalizeUpload(current.user.id, reservationId) }, {
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
    });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
