/**
 * Mints a short-lived preview token for a draft: POST here, then GET the returned
 * /api/v1/content/preview/<token> to read it.
 *
 * Nothing in this repository calls it, and that is not an oversight. The admin previews
 * its own drafts through `adminPreviewHref`, which is scoped to the owner's session --
 * this endpoint exists for a headless frontend, which has no session to scope to and is
 * promised draft previews by the README's headless mode. It is deliberately absent from
 * /api/v1/content/openapi.json: that document describes the public content contract, and
 * both halves of the preview flow are private (tests/unit/public-http.test.ts pins that
 * previews stay private and that their token paths are redacted).
 *
 * So: no caller is expected. Do not delete it for being unused.
 */
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
