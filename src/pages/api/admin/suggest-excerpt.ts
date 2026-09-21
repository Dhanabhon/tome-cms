import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';
import { z } from 'zod';

import { editorDocumentSchema } from '../../../lib/editor-content';
import { assertSameOrigin } from '../../../server/auth/origin';
import { requireInstalledOwner } from '../../../server/auth/session';
import { suggestExcerpt } from '../../../server/content/excerpt-suggestion';
import { getServerEnv } from '../../../server/env';
import { adminErrorResponse, HttpError } from '../../../server/http/errors';
import { parseJson } from '../../../server/http/json';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;

/** The draft as it stands, for a post or a page alike: an excerpt is the same thing on both. */
const askSchema = z.object({
  title: z.string().trim().max(200),
  contentJson: editorDocumentSchema,
  locale: z.enum(['th', 'en']),
}).strict();

export const POST: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    await requireInstalledOwner(request.headers);
    try {
      assertSameOrigin(request, configuredOrigin);
    } catch {
      throw new HttpError(403, 'Request origin is not allowed.');
    }
    // Null is the honest answer to "nothing works alone", to "no key" and to "no answer".
    const excerpt = await suggestExcerpt(await parseJson(request, askSchema));
    return Response.json({ excerpt }, { headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId } });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
