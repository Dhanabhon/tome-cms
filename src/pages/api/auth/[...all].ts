import type { APIRoute } from 'astro';

import { auth } from '../../../server/auth/config';
import { assertSameOrigin } from '../../../server/auth/origin';
import { getServerEnv } from '../../../server/env';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;

export const ALL: APIRoute = ({ request }) => {
  try {
    assertSameOrigin(request, configuredOrigin);
  } catch {
    return Response.json({ error: 'Request origin is not allowed.' }, {
      headers: { 'Cache-Control': 'no-store' },
      status: 403,
    });
  }
  return auth.handler(request);
};
