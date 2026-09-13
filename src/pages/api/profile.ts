import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';

import { assertSameOrigin } from '../../server/auth/origin';
import { requireOwner } from '../../server/auth/session';
import { profileMutationSchema, updateOwnerProfile } from '../../server/content/settings';
import { getServerEnv } from '../../server/env';
import { adminErrorResponse, HttpError } from '../../server/http/errors';
import { parseJson } from '../../server/http/json';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;

export const PUT: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireOwner(request.headers);
    try {
      assertSameOrigin(request, configuredOrigin);
    } catch {
      throw new HttpError(403, 'Request origin is not allowed.');
    }
    const input = await parseJson(request, profileMutationSchema);
    const settings = await updateOwnerProfile(current.user.id, input);
    return Response.json({ settings }, {
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
    });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
