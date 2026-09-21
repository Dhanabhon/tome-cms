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

/**
 * The draft as it stands, for a post or a page alike -- a passage is the same thing on both --
 * and which of its fields the passage is for.
 */
const askSchema = z.object({
  title: z.string().trim().max(200),
  contentJson: editorDocumentSchema,
  locale: z.enum(['th', 'en']),
  purpose: z.enum(['excerpt', 'description']).default('excerpt'),
}).strict();

export const POST: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    try {
      assertSameOrigin(request, configuredOrigin);
    } catch {
      throw new HttpError(403, 'Request origin is not allowed.');
    }
    // Null is the honest answer to "nothing works alone", to "no key" and to "no answer".
    const { purpose, ...draft } = await parseJson(request, askSchema);
    const excerpt = await suggestExcerpt(draft, current.user.id, purpose);
    return Response.json({ excerpt }, { headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId } });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
