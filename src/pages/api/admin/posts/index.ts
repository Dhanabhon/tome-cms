import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';
import { z } from 'zod';

import { assertSameOrigin } from '../../../../server/auth/origin';
import { requireInstalledOwner } from '../../../../server/auth/session';
import {
  createPost,
  createPostSchema,
  deletePost,
  getPost,
  listPosts,
  updatePost,
  updatePostSchema,
  updatePostStatus,
} from '../../../../server/content/posts';
import { getServerEnv } from '../../../../server/env';
import { adminErrorResponse, HttpError } from '../../../../server/http/errors';
import { parseJson } from '../../../../server/http/json';
import { deleteMutationSchema, statusMutationSchema } from '../../../../server/content/mutations';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;

function guardOrigin(request: Request): void {
  try {
    assertSameOrigin(request, configuredOrigin);
  } catch {
    throw new HttpError(403, 'Request origin is not allowed.');
  }
}

function success(body: unknown, requestId: string, status = 200): Response {
  return Response.json(body, {
    headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
    status,
  });
}

export const GET: APIRoute = async ({ request, url }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    guardOrigin(request);
    const requestedId = url.searchParams.get('id');
    if (!requestedId) return success({ posts: await listPosts(current.user.id) }, requestId);
    const post = await getPost(current.user.id, z.uuid().parse(requestedId));
    if (!post) throw new HttpError(404, 'Post not found.');
    return success({ post }, requestId);
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    guardOrigin(request);
    return success({ post: await createPost(current.user.id, await parseJson(request, createPostSchema)) }, requestId, 201);
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};

export const PUT: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    guardOrigin(request);
    return success({ post: await updatePost(current.user.id, await parseJson(request, updatePostSchema)) }, requestId);
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};

export const PATCH: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    guardOrigin(request);
    return success({ post: await updatePostStatus(current.user.id, await parseJson(request, statusMutationSchema)) }, requestId);
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    guardOrigin(request);
    const input = await parseJson(request, deleteMutationSchema);
    await deletePost(current.user.id, input.id, input.updatedAt);
    return new Response(null, {
      status: 204,
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
    });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
