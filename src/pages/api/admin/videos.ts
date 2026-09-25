import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';
import { z } from 'zod';

import { assertSameOrigin } from '../../../server/auth/origin';
import { requireInstalledOwner } from '../../../server/auth/session';
import { getServerEnv } from '../../../server/env';
import { adminErrorResponse, HttpError } from '../../../server/http/errors';
import { parseJson } from '../../../server/http/json';
import { createRateLimit } from '../../../server/stats/rules';
import { resolveVideo } from '../../../server/video/resolve';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;
const lookups = createRateLimit({ capacity: 1_000, limit: 30, windowMs: 60_000 });
const askSchema = z.object({ link: z.string().trim().min(1).max(2_048) }).strict();

export const POST: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    try {
      assertSameOrigin(request, configuredOrigin);
    } catch {
      throw new HttpError(403, 'Request origin is not allowed.');
    }
    if (!lookups.allow(current.user.id)) throw new HttpError(429, 'Too many video lookups. Try again in a minute.');
    const { link } = await parseJson(request, askSchema);
    const video = await resolveVideo(current.user.id, link);
    return Response.json(video, { headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId } });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
