import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';

import { assertSameOrigin } from '../../../../../server/auth/origin';
import { requireInstalledOwner } from '../../../../../server/auth/session';
import { markdownImportSchema, previewMarkdownImport } from '../../../../../server/content/markdown-import-post';
import { getServerEnv } from '../../../../../server/env';
import { adminErrorResponse, HttpError } from '../../../../../server/http/errors';
import { parseJson } from '../../../../../server/http/json';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;

// What an import would make, and nothing saved: the sheet shows it before any picture is uploaded.
export const POST: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    try {
      assertSameOrigin(request, configuredOrigin);
    } catch {
      throw new HttpError(403, 'Request origin is not allowed.');
    }
    const preview = await previewMarkdownImport(current.user.id, await parseJson(request, markdownImportSchema));
    return Response.json({ preview }, { headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId } });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
