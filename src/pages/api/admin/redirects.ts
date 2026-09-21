import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';
import { z } from 'zod';

import { assertSameOrigin } from '../../../server/auth/origin';
import { requireInstalledOwner } from '../../../server/auth/session';
import { addRedirect, deleteRedirect, listRedirects } from '../../../server/content/redirects';
import { getServerEnv } from '../../../server/env';
import { adminErrorResponse, HttpError } from '../../../server/http/errors';
import { parseJson } from '../../../server/http/json';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;

const kind = z.enum(['page', 'post']);
const addSchema = z.object({
  kind,
  // Checked against the address rule where it is written; bounded here so a request cannot
  // be large before it is refused.
  slug: z.string().max(160),
  targetId: z.uuid(),
}).strict();
const removeSchema = z.object({
  kind,
  locale: z.enum(['th', 'en']),
  slug: z.string().max(160),
}).strict();

async function mutate(request: Request, change: (ownerId: string) => Promise<void>): Promise<Response> {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    try {
      assertSameOrigin(request, configuredOrigin);
    } catch {
      throw new HttpError(403, 'Request origin is not allowed.');
    }
    await change(current.user.id);
    // The whole list back, so the screen shows what the table now says rather than what it
    // guessed the change would do.
    return Response.json({ redirects: await listRedirects(current.user.id) }, {
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
    });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}

export const POST: APIRoute = async ({ request }) => mutate(request, async (ownerId) => {
  await addRedirect(ownerId, await parseJson(request, addSchema));
});

export const DELETE: APIRoute = async ({ request }) => mutate(request, async (ownerId) => {
  await deleteRedirect(ownerId, await parseJson(request, removeSchema));
});
