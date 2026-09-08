import type { APIRoute } from 'astro';
import { isAuthError } from '@supabase/supabase-js';
import { z } from 'zod';

import { getCategoryIdsForPost } from '../../../lib/categories';
import { authenticate } from '../../../lib/supabase';

const membershipSchema = z.object({
  postId: z.uuid(),
  categoryIds: z.array(z.uuid()).max(20),
}).strict().superRefine(({ categoryIds }, context) => {
  if (new Set(categoryIds).size !== categoryIds.length) {
    context.addIssue({ code: 'custom', message: 'Duplicate Category IDs.' });
  }
});

function invalidPayload() {
  return Response.json({ error: 'Invalid Category membership payload.' }, { status: 400 });
}

function authenticationError(error: unknown) {
  return isAuthError(error) && (error.status === 401 || error.status === 403);
}

function serverError(error: unknown) {
  console.error('Post Category provider failure:', error);
  return Response.json({ error: 'Post Categories could not be saved.' }, { status: 500 });
}

export const PUT: APIRoute = async ({ cookies, request }) => {
  try {
    const auth = await authenticate(cookies, request);
    if (!auth) return Response.json({ error: 'Authentication required.' }, { status: 401 });
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return invalidPayload();
    }
    const parsed = membershipSchema.safeParse(body);
    if (!parsed.success) return invalidPayload();

    const current = await getCategoryIdsForPost(auth.supabase, auth.user.id, parsed.data.postId);
    if (current === null) return Response.json({ error: 'Post not found.' }, { status: 404 });
    const { data, error } = await auth.supabase.rpc('replace_post_categories', {
      requested_category_ids: parsed.data.categoryIds,
      target_post_id: parsed.data.postId,
    });
    if (error) {
      if (['22023', '22P02', '23503', '23505', '23514'].includes(error.code)) return invalidPayload();
      if (error.code === '42501') return Response.json({ error: 'Post not found.' }, { status: 404 });
      return serverError(error);
    }
    return Response.json({ categoryIds: data.map(({ category_id }) => category_id) });
  } catch (error) {
    if (authenticationError(error)) return Response.json({ error: 'Authentication required.' }, { status: 401 });
    return serverError(error);
  }
};
