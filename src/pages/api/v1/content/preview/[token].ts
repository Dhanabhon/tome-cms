import type { APIRoute } from 'astro';

import { getPreviewContent } from '../../../../../server/content/previews';
import { HttpError } from '../../../../../server/http/errors';
import { privatePreviewError } from '../../../../../server/http/problem';
import { privatePreviewJson } from '../../../../../server/http/public-response';
import { serializePublicPage, serializePublicPost } from '../../../../../server/http/serialize';

export const GET: APIRoute = async ({ params, request }) => {
  const startedAt = performance.now();
  try {
    const preview = await getPreviewContent(params.token ?? '');
    if (!preview) throw new HttpError(404, 'Preview not found.');
    const content = preview.contentType === 'post'
      ? serializePublicPost(preview.content)
      : serializePublicPage(preview.content);
    return privatePreviewJson(request, {
      data: { content, contentType: preview.contentType },
    }, startedAt);
  } catch (error) {
    return privatePreviewError(request, error, startedAt);
  }
};
