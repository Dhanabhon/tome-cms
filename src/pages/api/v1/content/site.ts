import type { APIRoute } from 'astro';

import { getPublishedSite } from '../../../../server/content/published';
import { HttpError } from '../../../../server/http/errors';
import { publicError } from '../../../../server/http/problem';
import { publicJson, publicOptions } from '../../../../server/http/public-response';
import { emptyQuerySchema, parsePublicQuery } from '../../../../server/http/public-schemas';
import { serializePublicSite } from '../../../../server/http/serialize';

export const GET: APIRoute = async ({ request }) => {
  const startedAt = performance.now();
  try {
    parsePublicQuery(new URL(request.url).searchParams, emptyQuerySchema);
    const site = await getPublishedSite();
    if (!site) throw new HttpError(503, 'Site settings are unavailable.');
    return publicJson(request, { data: serializePublicSite(site.settings, site.avatar) }, {
      lastModified: site.lastModified,
      startedAt,
    });
  } catch (error) {
    return publicError(request, error, startedAt);
  }
};

export const OPTIONS: APIRoute = ({ request }) => publicOptions(request);
