import type { APIRoute } from 'astro';
import { z } from 'zod';

import { db } from '../../server/db/client';
import { variantWidth } from '../../server/media/image';
import { resolveMediaUrl } from '../../server/media/url';

/** The original, or with `?w=480|960|1600` its copy at that width when it has one. */
export const GET: APIRoute = async ({ params, url }) => {
  const id = z.uuid().safeParse(params.id);
  if (!id.success) return new Response('Not found.', { headers: { 'Cache-Control': 'no-store' }, status: 404 });
  const width = variantWidth(url.searchParams.get('w'));
  try {
    const item = await db.selectFrom('media_items').select('media_items.object_key')
      .$if(width !== null, (query) => query
        .leftJoin('media_variants', (join) => join.onRef('media_variants.media_id', '=', 'media_items.id').on('media_variants.width', '=', width!))
        .select('media_variants.object_key as variant_key'))
      .where('media_items.id', '=', id.data).where('media_items.state', '=', 'ready').executeTakeFirst();
    if (!item) return new Response('Not found.', { headers: { 'Cache-Control': 'no-store' }, status: 404 });
    return new Response(null, {
      headers: {
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400',
        Location: resolveMediaUrl(item.variant_key ?? item.object_key),
      },
      status: 302,
    });
  } catch {
    console.error('Public media lookup failed');
    return new Response('Media is temporarily unavailable.', { headers: { 'Cache-Control': 'no-store' }, status: 503 });
  }
};
