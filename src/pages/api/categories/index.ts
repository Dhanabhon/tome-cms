import type { APIRoute } from 'astro';
import { isAuthError } from '@supabase/supabase-js';
import { z } from 'zod';

import { getOwnerCategories } from '../../../lib/categories';
import { authenticate } from '../../../lib/supabase';

const createSchema = z.object({ name: z.string().trim().min(1).max(80) }).strict();
const updateSchema = z.object({ id: z.uuid(), name: z.string().trim().min(1).max(80) }).strict();
const deleteSchema = z.object({ id: z.uuid() }).strict();

function invalidPayload() {
  return Response.json({ error: 'Invalid Category payload.' }, { status: 400 });
}

async function readJson(request: Request): Promise<unknown | Response> {
  try {
    return await request.json();
  } catch {
    return invalidPayload();
  }
}

function authenticationError(error: unknown) {
  return isAuthError(error) && (error.status === 401 || error.status === 403);
}

function serverError(error: unknown, message: string) {
  console.error('Category API provider failure:', error);
  return Response.json({ error: message }, { status: 500 });
}

function conflict() {
  return Response.json({ error: 'That Category name is already in use or protected.' }, { status: 409 });
}

export const GET: APIRoute = async ({ cookies, request }) => {
  try {
    const auth = await authenticate(cookies, request);
    if (!auth) return Response.json({ error: 'Authentication required.' }, { status: 401 });
    return Response.json({ categories: await getOwnerCategories(auth.supabase, auth.user.id) });
  } catch (error) {
    if (authenticationError(error)) return Response.json({ error: 'Authentication required.' }, { status: 401 });
    return serverError(error, 'Categories could not be loaded.');
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const auth = await authenticate(cookies, request);
    if (!auth) return Response.json({ error: 'Authentication required.' }, { status: 401 });
    const body = await readJson(request);
    if (body instanceof Response) return body;
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return invalidPayload();

    const { data, error } = await auth.supabase.from('categories')
      .insert({ owner_id: auth.user.id, name: parsed.data.name, is_default: false }).select().single();
    if (error) {
      if (error.code === '23505' || error.code === '23514' || error.code === '42501') return conflict();
      return serverError(error, 'The Category could not be created.');
    }
    return Response.json({ category: { ...data, postCount: 0 } }, { status: 201 });
  } catch (error) {
    if (authenticationError(error)) return Response.json({ error: 'Authentication required.' }, { status: 401 });
    return serverError(error, 'The Category could not be created.');
  }
};

export const PUT: APIRoute = async ({ cookies, request }) => {
  try {
    const auth = await authenticate(cookies, request);
    if (!auth) return Response.json({ error: 'Authentication required.' }, { status: 401 });
    const body = await readJson(request);
    if (body instanceof Response) return body;
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return invalidPayload();

    const { data, error } = await auth.supabase.from('categories').update({ name: parsed.data.name })
      .eq('id', parsed.data.id).eq('owner_id', auth.user.id).eq('is_default', false).select().maybeSingle();
    if (error) {
      if (error.code === '23505' || error.code === '23514' || error.code === '42501') return conflict();
      return serverError(error, 'The Category could not be updated.');
    }
    if (data) return Response.json({ category: data });

    const { data: existing, error: readError } = await auth.supabase.from('categories').select('is_default')
      .eq('id', parsed.data.id).eq('owner_id', auth.user.id).maybeSingle();
    if (readError) return serverError(readError, 'The Category could not be updated.');
    if (existing?.is_default) return conflict();
    return Response.json({ error: 'Category not found.' }, { status: 404 });
  } catch (error) {
    if (authenticationError(error)) return Response.json({ error: 'Authentication required.' }, { status: 401 });
    return serverError(error, 'The Category could not be updated.');
  }
};

export const DELETE: APIRoute = async ({ cookies, request }) => {
  try {
    const auth = await authenticate(cookies, request);
    if (!auth) return Response.json({ error: 'Authentication required.' }, { status: 401 });
    const body = await readJson(request);
    if (body instanceof Response) return body;
    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) return invalidPayload();

    const { data: existing, error: readError } = await auth.supabase.from('categories').select('is_default')
      .eq('id', parsed.data.id).eq('owner_id', auth.user.id).maybeSingle();
    if (readError) return serverError(readError, 'The Category could not be deleted.');
    if (!existing) return Response.json({ error: 'Category not found.' }, { status: 404 });
    if (existing.is_default) return conflict();

    const { data, error } = await auth.supabase.rpc('delete_post_category', { target_category_id: parsed.data.id });
    if (error) {
      if (error.code === '42501') return Response.json({ error: 'Category not found.' }, { status: 404 });
      if (error.code === '23514') return conflict();
      return serverError(error, 'The Category could not be deleted.');
    }
    return Response.json({ affectedPosts: data });
  } catch (error) {
    if (authenticationError(error)) return Response.json({ error: 'Authentication required.' }, { status: 401 });
    return serverError(error, 'The Category could not be deleted.');
  }
};
