import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';
import { z } from 'zod';

import { assertSameOrigin } from '../../../../server/auth/origin';
import { requireInstalledOwner } from '../../../../server/auth/session';
import { getServerEnv } from '../../../../server/env';
import { adminErrorResponse, HttpError } from '../../../../server/http/errors';
import { parseJson } from '../../../../server/http/json';
import { readThemeSettings, writeThemeSettings } from '../../../../server/themes/store';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;

/**
 * Values are read as bounded strings here and checked against the theme's own declarations
 * where they are written: what a key means is the theme's business, and the size of a
 * request is the product's.
 */
const mutationSchema = z.object({
  id: z.string().min(1).max(64),
  values: z.record(z.string().min(1).max(64), z.string().max(256)),
}).strict();

export const PUT: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    try {
      assertSameOrigin(request, configuredOrigin);
    } catch {
      throw new HttpError(403, 'Request origin is not allowed.');
    }
    const input = await parseJson(request, mutationSchema);
    await writeThemeSettings(current.user.id, input);
    return Response.json({ settings: await readThemeSettings(input.id) }, {
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
    });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
