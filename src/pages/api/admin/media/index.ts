import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';

import { assertSameOrigin } from '../../../../server/auth/origin';
import { requireInstalledOwner } from '../../../../server/auth/session';
import { getServerEnv } from '../../../../server/env';
import { adminErrorResponse, HttpError } from '../../../../server/http/errors';
import { listMedia, mediaListInputSchema } from '../../../../server/media/service';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;

export const GET: APIRoute = async ({ request, url }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    try {
      assertSameOrigin(request, configuredOrigin);
    } catch {
      throw new HttpError(403, 'Request origin is not allowed.');
    }
    const requestedFolder = url.searchParams.get('folderId');
    const input = mediaListInputSchema.parse({
      folderId: requestedFolder === 'unfiled' ? null : requestedFolder || undefined,
      page: url.searchParams.get('page') || undefined,
      search: url.searchParams.get('search') ?? '',
    });
    return Response.json(await listMedia(current.user.id, input), {
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
    });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
