import type { APIRoute } from 'astro';
import { z } from 'zod';

import { db } from '../../server/db/client';
import { resolveMediaUrl } from '../../server/media/url';

export const GET: APIRoute = async ({ params }) => {
  const id = z.uuid().safeParse(params.id);
  if (!id.success) return new Response('Not found.', { headers: { 'Cache-Control': 'no-store' }, status: 404 });
  try {
    const item = await db.selectFrom('media_items').select('object_key')
      .where('id', '=', id.data).where('state', '=', 'ready').executeTakeFirst();
    if (!item) return new Response('Not found.', { headers: { 'Cache-Control': 'no-store' }, status: 404 });
    return new Response(null, {
      headers: {
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400',
        Location: resolveMediaUrl(item.object_key),
      },
      status: 302,
    });
  } catch {
    console.error('Public media lookup failed');
    return new Response('Media is temporarily unavailable.', { headers: { 'Cache-Control': 'no-store' }, status: 503 });
  }
};
