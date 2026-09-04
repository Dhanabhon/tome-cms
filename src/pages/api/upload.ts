import type { APIRoute } from 'astro';

import { imageExtension, MAX_IMAGE_BYTES } from '../../lib/media';
import { authenticate } from '../../lib/supabase';

export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const auth = await authenticate(cookies, request);
    if (!auth) return Response.json({ error: 'Authentication required.' }, { status: 401 });

    const contentType = request.headers.get('content-type')?.split(';')[0] ?? '';
    const extension = imageExtension(contentType);
    if (!extension) return Response.json({ error: 'Unsupported image type.' }, { status: 415 });

    const declaredSize = Number(request.headers.get('content-length') ?? 0);
    if (declaredSize > MAX_IMAGE_BYTES) {
      return Response.json({ error: 'Images must be 8 MB or smaller.' }, { status: 413 });
    }

    const body = await request.arrayBuffer();
    if (!body.byteLength || body.byteLength > MAX_IMAGE_BYTES) {
      return Response.json({ error: 'Images must be between 1 byte and 8 MB.' }, { status: 413 });
    }

    const path = `${auth.user.id}/${crypto.randomUUID()}.${extension}`;
    const { error } = await auth.supabase.storage.from('blog-media').upload(path, body, {
      cacheControl: '31536000',
      contentType,
      upsert: false,
    });

    if (error) {
      console.error('Image upload error:', error.message);
      return Response.json({ error: 'The image could not be uploaded.' }, { status: 500 });
    }

    const { data } = auth.supabase.storage.from('blog-media').getPublicUrl(path);
    return Response.json({ url: data.publicUrl }, { status: 201 });
  } catch (error) {
    console.error('Image upload error:', error);
    return Response.json({ error: 'The image could not be uploaded.' }, { status: 500 });
  }
};
