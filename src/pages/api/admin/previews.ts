import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';

import { assertSameOrigin } from '../../../server/auth/origin';
import { requireInstalledOwner } from '../../../server/auth/session';
import { createPreviewInputSchema, createPreviewToken } from '../../../server/content/previews';
import { getServerEnv } from '../../../server/env';
import { adminErrorResponse, HttpError } from '../../../server/http/errors';
import { parseJson } from '../../../server/http/json';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;

export const POST: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    try {
      assertSameOrigin(request, configuredOrigin);
    } catch {
      throw new HttpError(403, 'Request origin is not allowed.');
    }
    const current = await requireInstalledOwner(request.headers);
    const input = await parseJson(request, createPreviewInputSchema);
    const preview = await createPreviewToken(current.user.id, input);
    return Response.json({ url: `/api/v1/content/preview/${preview.token}` }, {
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
      status: 201,
    });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
