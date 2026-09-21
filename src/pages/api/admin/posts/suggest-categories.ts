import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';
import { z } from 'zod';

import { assertSameOrigin } from '../../../../server/auth/origin';
import { requireInstalledOwner } from '../../../../server/auth/session';
import { suggestCategories } from '../../../../server/content/category-suggestions';
import { editorDocumentSchema } from '../../../../lib/editor-content';
import { getServerEnv } from '../../../../server/env';
import { adminErrorResponse, HttpError } from '../../../../server/http/errors';
import { parseJson } from '../../../../server/http/json';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;

/**
 * The draft as it stands, which is not always the draft as it is stored: an owner may ask
 * before an autosave has run, and the answer should be about what they have written.
 */
const askSchema = z.object({
  title: z.string().trim().max(200),
  contentJson: editorDocumentSchema,
  locale: z.enum(['th', 'en']),
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
    const input = await parseJson(request, askSchema);
    // An empty list is the honest answer to "nothing fits", to "no key configured" and to
    // "the service did not answer". The screen shows nothing in all three, which is what
    // it should do: a suggestion that failed to arrive is not an error the owner caused.
    const suggestions = await suggestCategories(current.user.id, input);
    return Response.json({ suggestions }, {
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
    });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
