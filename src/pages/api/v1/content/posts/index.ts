import type { APIRoute } from 'astro';

import { listPublishedPosts } from '../../../../../server/content/published';
import { HttpError } from '../../../../../server/http/errors';
import { publicError } from '../../../../../server/http/problem';
import { nextPublicUrl, publicJson, publicOptions } from '../../../../../server/http/public-response';
import { parsePublicQuery, postListQuerySchema } from '../../../../../server/http/public-schemas';
import { maySearch } from '../../../../../server/http/search-limit';
import { serializePublicPost } from '../../../../../server/http/serialize';

export const GET: APIRoute = async ({ clientAddress, request }) => {
  const startedAt = performance.now();
  try {
    const query = parsePublicQuery(new URL(request.url).searchParams, postListQuerySchema);
    if (query.q && !maySearch(request, clientAddress)) throw new HttpError(429, 'Too many searches. Try again in a minute.');
    const result = await listPublishedPosts(query);
    return publicJson(request, {
      data: result.items.map(serializePublicPost),
      meta: { locale: query.locale, limit: query.limit, hasMore: result.hasMore },
      links: { next: nextPublicUrl(request.url, result.nextCursor) },
    }, { lastModified: result.lastModified, startedAt });
  } catch (error) {
    const response = publicError(request, error, startedAt);
    if (response.status === 429) {
      response.headers.set('Retry-After', '60');
      response.headers.set('Access-Control-Expose-Headers', 'Retry-After');
    }
    return response;
  }
};

export const OPTIONS: APIRoute = ({ request }) => publicOptions(request);
