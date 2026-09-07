import type { APIRoute } from 'astro';
import { z } from 'zod';

import { authenticate } from '../../../lib/supabase';

export const DELETE: APIRoute = async ({ cookies, params, request }) => {
  try {
    const auth = await authenticate(cookies, request);
    if (!auth) return Response.json({ error: 'Authentication required.' }, { status: 401 });

    const id = z.uuid().safeParse(params.id);
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
    // ponytail: O(owner posts + pages) scan has a concurrent-edit window; add relational media_usage when volume or serialization matters.
    const references: { id: string; title: string }[] = [];
    for (let start = 0; ; start += 1000) {
      const { data: posts, error: postsError } = await auth.supabase
        .from('posts')
        .select('id, title, cover_image, content_html')
        .eq('author_id', auth.user.id)
        .order('id')
        .range(start, start + 999);
      if (postsError) throw postsError;
      references.push(...posts
        .filter((post) => post.cover_image === publicUrl || post.content_html.includes(publicUrl))
        .map(({ id: postId, title }) => ({ id: postId, title })));
      if (posts.length < 1000) break;
    }
    const pageReferences: typeof references = [];
    for (let start = 0; ; start += 1000) {
      const { data: pages, error: pagesError } = await auth.supabase
        .from('pages')
        .select('id, title, content_html')
        .eq('author_id', auth.user.id)
        .order('id')
        .range(start, start + 999);
      if (pagesError) throw pagesError;
      pageReferences.push(...pages
        .filter((page) => page.content_html.includes(publicUrl))
        .map(({ id: pageId, title }) => ({ id: pageId, title })));
      if (pages.length < 1000) break;
    }
    if (references.length || pageReferences.length) {
      const usage = [
        references.length && `${references.length} post${references.length === 1 ? '' : 's'}`,
        pageReferences.length && `${pageReferences.length} page${pageReferences.length === 1 ? '' : 's'}`,
      ].filter(Boolean).join(' and ');
      return Response.json(
        {
          error: `This image is used by ${usage}.`,
          posts: references,
          ...(pageReferences.length ? { pages: pageReferences } : {}),
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
