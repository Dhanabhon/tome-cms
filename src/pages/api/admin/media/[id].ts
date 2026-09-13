import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';
import { z } from 'zod';

import { assertSameOrigin } from '../../../../server/auth/origin';
import { requireInstalledOwner } from '../../../../server/auth/session';
import { getServerEnv } from '../../../../server/env';
import { adminErrorResponse, HttpError } from '../../../../server/http/errors';
import { parseJson } from '../../../../server/http/json';
import { deleteMedia, mediaMutationSchema, updateMedia } from '../../../../server/media/service';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;

function guard(request: Request): void {
  try {
    assertSameOrigin(request, configuredOrigin);
  } catch {
    throw new HttpError(403, 'Request origin is not allowed.');
  }
}

export const PUT: APIRoute = async ({ params, request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    guard(request);
    const input = await parseJson(request, mediaMutationSchema);
    const id = z.uuid().parse(params.id);
    return Response.json({ item: await updateMedia(current.user.id, id, input) }, {
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
    });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};

export const DELETE: APIRoute = async ({ params, request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    guard(request);
    await deleteMedia(current.user.id, z.uuid().parse(params.id));
    return Response.json({ deleted: true }, {
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
    });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
