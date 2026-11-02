import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';

import { isPostLocale } from '../../../lib/i18n';
import { assertSameOrigin } from '../../../server/auth/origin';
import { requireInstalledOwner } from '../../../server/auth/session';
import { listPostListOptions } from '../../../server/content/post-lists';
import { getServerEnv } from '../../../server/env';
import { adminErrorResponse, HttpError } from '../../../server/http/errors';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;

export const GET: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    try {
      assertSameOrigin(request, configuredOrigin);
    } catch {
      throw new HttpError(403, 'Request origin is not allowed.');
    }
    const locale = new URL(request.url).searchParams.get('locale');
    if (!isPostLocale(locale)) throw new HttpError(400, 'Unknown language.');
    return Response.json({ options: await listPostListOptions(current.user.id, locale) }, {
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
    });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
