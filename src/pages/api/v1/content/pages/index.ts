import type { APIRoute } from 'astro';

import { listPublishedPages } from '../../../../../server/content/published';
import { publicError } from '../../../../../server/http/problem';
import { nextPublicUrl, publicJson, publicOptions } from '../../../../../server/http/public-response';
import { listQuerySchema, parsePublicQuery } from '../../../../../server/http/public-schemas';
import { serializePublicPage } from '../../../../../server/http/serialize';

export const GET: APIRoute = async ({ request }) => {
  const startedAt = performance.now();
  try {
    const query = parsePublicQuery(new URL(request.url).searchParams, listQuerySchema);
    const result = await listPublishedPages(query);
    return publicJson(request, {
      data: result.items.map(serializePublicPage),
      meta: { locale: query.locale, limit: query.limit, hasMore: result.hasMore },
      links: { next: nextPublicUrl(request.url, result.nextCursor) },
    }, { lastModified: result.lastModified, startedAt });
  } catch (error) {
    return publicError(request, error, startedAt);
  }
};

export const OPTIONS: APIRoute = ({ request }) => publicOptions(request);
