import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';
import { z } from 'zod';

import { assertSameOrigin } from '../../../../server/auth/origin';
import { requireInstalledOwner } from '../../../../server/auth/session';
import { duplicatePost } from '../../../../server/content/posts';
import { getServerEnv } from '../../../../server/env';
import { adminErrorResponse, HttpError } from '../../../../server/http/errors';
import { parseJson } from '../../../../server/http/json';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;

// No updatedAt. Every other row action rewrites the record it names, so a stale
// token there means overwriting somebody's change; duplicating only reads, and
// refusing it because the source moved would cost the writer a copy for nothing.
const duplicateSchema = z.object({ id: z.uuid() }).strict();

export const POST: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    try {
      assertSameOrigin(request, configuredOrigin);
    } catch {
      throw new HttpError(403, 'Request origin is not allowed.');
    }
    const { id } = await parseJson(request, duplicateSchema);
    return Response.json({ post: await duplicatePost(current.user.id, id) }, {
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
      status: 201,
    });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
