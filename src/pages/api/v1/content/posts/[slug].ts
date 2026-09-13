import type { APIRoute } from 'astro';

import { getPublishedPost } from '../../../../../server/content/published';
import { HttpError } from '../../../../../server/http/errors';
import { publicError } from '../../../../../server/http/problem';
import { publicJson, publicOptions } from '../../../../../server/http/public-response';
import {
  detailQuerySchema,
  parsePublicQuery,
  publicContentSlugSchema,
} from '../../../../../server/http/public-schemas';
import { serializePublicPost } from '../../../../../server/http/serialize';

export const GET: APIRoute = async ({ params, request }) => {
  const startedAt = performance.now();
  try {
    const query = parsePublicQuery(new URL(request.url).searchParams, detailQuerySchema);
    const slug = publicContentSlugSchema.parse(params.slug);
    const post = await getPublishedPost(query.locale, slug);
    if (!post) throw new HttpError(404, 'Post not found.');
    return publicJson(request, { data: serializePublicPost(post) }, { lastModified: post.lastModified, startedAt });
  } catch (error) {
    return publicError(request, error, startedAt);
  }
};

export const OPTIONS: APIRoute = ({ request }) => publicOptions(request);
