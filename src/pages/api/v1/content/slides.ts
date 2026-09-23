import type { APIRoute } from 'astro';

import { getPublicSlidesSnapshot } from '../../../../server/content/slides';
import { publicError } from '../../../../server/http/problem';
import { publicJson, publicOptions } from '../../../../server/http/public-response';
import { detailQuerySchema, parsePublicQuery } from '../../../../server/http/public-schemas';
import { serializePublicSlides } from '../../../../server/http/serialize';

export const GET: APIRoute = async ({ request }) => {
  const startedAt = performance.now();
  try {
    const query = parsePublicQuery(new URL(request.url).searchParams, detailQuerySchema);
    const result = await getPublicSlidesSnapshot(query.locale);
    return publicJson(request, {
      data: serializePublicSlides(result.slides),
      meta: { locale: query.locale },
    }, { lastModified: result.lastModified, startedAt });
  } catch (error) {
    return publicError(request, error, startedAt);
  }
};

export const OPTIONS: APIRoute = ({ request }) => publicOptions(request);
