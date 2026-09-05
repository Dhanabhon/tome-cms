import type { APIRoute } from 'astro';
import { z } from 'zod';

import { authenticate } from '../../../lib/supabase';

export const DELETE: APIRoute = async ({ cookies, params, request }) => {
  try {
    const auth = await authenticate(cookies, request);
    if (!auth) return Response.json({ error: 'Authentication required.' }, { status: 401 });

    const id = z.string().uuid().safeParse(params.id);
    if (!id.success) return Response.json({ error: 'Media not found.' }, { status: 404 });

    const { data: media, error: mediaError } = await auth.supabase
      .from('media_items')
      .select('id, storage_path')
      .eq('id', id.data)
      .eq('owner_id', auth.user.id)
      .maybeSingle();
    if (mediaError) throw mediaError;
    if (!media) return Response.json({ error: 'Media not found.' }, { status: 404 });

    const publicUrl = auth.supabase.storage.from('blog-media').getPublicUrl(media.storage_path).data.publicUrl;
    const { data: posts, error: postsError } = await auth.supabase
      .from('posts')
      .select('id, title, cover_image, content_html')
      .eq('author_id', auth.user.id);
    if (postsError) throw postsError;

    // ponytail: O(owner posts) scan has a concurrent-edit window; add relational media_usage when volume or serialization matters.
    const references = posts
      .filter((post) => post.cover_image === publicUrl || post.content_html.includes(publicUrl))
      .map(({ id: postId, title }) => ({ id: postId, title }));
    if (references.length) {
      return Response.json(
        {
          error: `This image is used by ${references.length} post${references.length === 1 ? '.' : 's.'}`,
          posts: references,
        },
        { status: 409 },
      );
    }

    // ponytail: Storage and metadata deletes are not atomic; retry recovers stale metadata after a partial failure.
    const { error: storageError } = await auth.supabase.storage.from('blog-media').remove([media.storage_path]);
    if (storageError) throw storageError;

    const { data: deleted, error: deleteError } = await auth.supabase
      .from('media_items')
      .delete()
      .eq('id', id.data)
      .eq('owner_id', auth.user.id)
      .select('id')
      .maybeSingle();
    if (deleteError) throw deleteError;
    if (!deleted) throw new Error('Media metadata disappeared during deletion.');

    return Response.json({ deleted: true });
  } catch (error) {
    console.error('Media deletion error:', error);
    return Response.json({ error: 'The image could not be deleted.' }, { status: 500 });
  }
};
