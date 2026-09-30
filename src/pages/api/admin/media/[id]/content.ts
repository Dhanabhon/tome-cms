import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';
import { z } from 'zod';

import { assertSameOrigin } from '../../../../../server/auth/origin';
import { requireInstalledOwner } from '../../../../../server/auth/session';
import { getServerEnv } from '../../../../../server/env';
import { adminErrorResponse, HttpError } from '../../../../../server/http/errors';
import { readPdf } from '../../../../../server/media/content';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;

/** A PDF's bytes for the File Manager's thumbnail, read in ranges by pdf.js. */
export const GET: APIRoute = async ({ params, request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    try {
      assertSameOrigin(request, configuredOrigin);
    } catch {
      throw new HttpError(403, 'Request origin is not allowed.');
    }
    const id = z.uuid().safeParse(params.id);
    if (!id.success) throw new HttpError(404, 'File not found.');
    return await readPdf(current.user.id, id.data, request.headers.get('range'));
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
