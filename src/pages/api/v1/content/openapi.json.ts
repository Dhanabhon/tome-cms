import type { APIRoute } from 'astro';

import { openApiDocument } from '../../../../server/http/openapi';
import { publicError } from '../../../../server/http/problem';
import { publicJson, publicOptions } from '../../../../server/http/public-response';
import { emptyQuerySchema, parsePublicQuery } from '../../../../server/http/public-schemas';

const loadedAt = new Date();

export const GET: APIRoute = ({ request }) => {
  const startedAt = performance.now();
  try {
    parsePublicQuery(new URL(request.url).searchParams, emptyQuerySchema);
    return publicJson(request, openApiDocument, { lastModified: loadedAt, maxAge: 86_400, startedAt });
  } catch (error) {
    return publicError(request, error, startedAt);
  }
};

export const OPTIONS: APIRoute = ({ request }) => publicOptions(request);
