import type { APIRoute } from 'astro';

import { checkReadiness } from '../../server/health';

export const GET: APIRoute = async () => {
  const result = await checkReadiness(AbortSignal.timeout(2_000));
  return Response.json(result, {
    status: result.status === 'ready' ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
};
