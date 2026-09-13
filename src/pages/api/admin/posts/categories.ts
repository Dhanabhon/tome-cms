import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';
import { z } from 'zod';

import { assertSameOrigin } from '../../../../server/auth/origin';
import { requireInstalledOwner } from '../../../../server/auth/session';
import { replacePostCategories } from '../../../../server/content/categories';
import { getServerEnv } from '../../../../server/env';
import { adminErrorResponse, HttpError } from '../../../../server/http/errors';
import { parseJson } from '../../../../server/http/json';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;
const membershipSchema = z.object({
  postId: z.uuid(),
  categoryIds: z.array(z.uuid()).max(20),
}).strict().superRefine(({ categoryIds }, context) => {
  if (new Set(categoryIds).size !== categoryIds.length) {
    context.addIssue({ code: 'custom', path: ['categoryIds'], message: 'Choose unique Categories.' });
  }
});

export const PUT: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    try {
      assertSameOrigin(request, configuredOrigin);
    } catch {
      throw new HttpError(403, 'Request origin is not allowed.');
    }
    const input = await parseJson(request, membershipSchema);
    const categoryIds = await replacePostCategories(current.user.id, input.postId, input.categoryIds);
    return Response.json({ categoryIds }, {
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
    });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
