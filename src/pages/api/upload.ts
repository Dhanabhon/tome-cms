import type { APIRoute } from 'astro';

export const POST: APIRoute = async () =>
  Response.json(
    { error: 'This upload endpoint has been retired. Use the authenticated Media Library.' },
    { status: 410 },
  );
