import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';
import { z } from 'zod';

import { assertSameOrigin } from '../../../../server/auth/origin';
import { requireOwner } from '../../../../server/auth/session';
import { createCategory, deleteCategory, listCategories, renameCategory } from '../../../../server/content/categories';
import { getServerEnv } from '../../../../server/env';
import { adminErrorResponse, HttpError } from '../../../../server/http/errors';
import { parseJson } from '../../../../server/http/json';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;
const createSchema = z.object({ name: z.string().trim().min(1).max(80) }).strict();
const updateSchema = z.object({ id: z.uuid(), name: z.string().trim().min(1).max(80) }).strict();
const deleteSchema = z.object({ id: z.uuid() }).strict();

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

export const GET: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireOwner(request.headers);
    guardOrigin(request);
    return success({ categories: await listCategories(current.user.id) }, requestId);
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireOwner(request.headers);
    guardOrigin(request);
    const input = await parseJson(request, createSchema);
    return success({ category: { ...await createCategory(current.user.id, input.name), postCount: 0 } }, requestId, 201);
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};

export const PUT: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireOwner(request.headers);
    guardOrigin(request);
    const input = await parseJson(request, updateSchema);
    return success({ category: await renameCategory(current.user.id, input.id, input.name) }, requestId);
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireOwner(request.headers);
    guardOrigin(request);
    const input = await parseJson(request, deleteSchema);
    const result = await deleteCategory(current.user.id, input.id);
    return success({ affectedPosts: result.affectedPostGroups }, requestId);
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
