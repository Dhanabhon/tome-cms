import type { APIRoute } from 'astro';

import { listPublishedPosts } from '../../../../../server/content/published';
import { publicError } from '../../../../../server/http/problem';
import { nextPublicUrl, publicJson, publicOptions } from '../../../../../server/http/public-response';
import { parsePublicQuery, postListQuerySchema } from '../../../../../server/http/public-schemas';
import { serializePublicPost } from '../../../../../server/http/serialize';

export const GET: APIRoute = async ({ request }) => {
  const startedAt = performance.now();
  try {
    const query = parsePublicQuery(new URL(request.url).searchParams, postListQuerySchema);
    const result = await listPublishedPosts(query);
    return publicJson(request, {
      data: result.items.map(serializePublicPost),
      meta: { locale: query.locale, limit: query.limit, hasMore: result.hasMore },
      links: { next: nextPublicUrl(request.url, result.nextCursor) },
    }, { lastModified: result.lastModified, startedAt });
  } catch (error) {
    return publicError(request, error, startedAt);
  }
};

export const OPTIONS: APIRoute = ({ request }) => publicOptions(request);
