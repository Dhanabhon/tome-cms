import type { APIRoute } from 'astro';

import { listPublishedCategories } from '../../../../server/content/published';
import { publicError } from '../../../../server/http/problem';
import { publicJson, publicOptions } from '../../../../server/http/public-response';
import { detailQuerySchema, parsePublicQuery } from '../../../../server/http/public-schemas';
import { serializePublicCategory } from '../../../../server/http/serialize';

export const GET: APIRoute = async ({ request }) => {
  const startedAt = performance.now();
  try {
    const query = parsePublicQuery(new URL(request.url).searchParams, detailQuerySchema);
    const result = await listPublishedCategories(query.locale);
    return publicJson(request, {
      data: result.items.map(serializePublicCategory),
      meta: { locale: query.locale },
    }, { lastModified: result.lastModified, startedAt });
  } catch (error) {
    return publicError(request, error, startedAt);
  }
};

export const OPTIONS: APIRoute = ({ request }) => publicOptions(request);
