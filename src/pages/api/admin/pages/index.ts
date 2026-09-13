import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';
import { z } from 'zod';

import { assertSameOrigin } from '../../../../server/auth/origin';
import { requireInstalledOwner } from '../../../../server/auth/session';
import { deleteMutationSchema, statusMutationSchema } from '../../../../server/content/mutations';
import {
  createPage,
  createPageSchema,
  deletePage,
  getPage,
  listPages,
  updatePage,
  updatePageSchema,
  updatePageStatus,
} from '../../../../server/content/pages';
import { getServerEnv } from '../../../../server/env';
import { adminErrorResponse, HttpError } from '../../../../server/http/errors';
import { parseJson } from '../../../../server/http/json';

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
    if (!requestedId) return success({ pages: await listPages(current.user.id) }, requestId);
    const page = await getPage(current.user.id, z.uuid().parse(requestedId));
    if (!page) throw new HttpError(404, 'Page not found.');
    return success({ page }, requestId);
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    guardOrigin(request);
    return success({ page: await createPage(current.user.id, await parseJson(request, createPageSchema)) }, requestId, 201);
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};

export const PUT: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    guardOrigin(request);
    return success({ page: await updatePage(current.user.id, await parseJson(request, updatePageSchema)) }, requestId);
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};

export const PATCH: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    guardOrigin(request);
    return success({ page: await updatePageStatus(current.user.id, await parseJson(request, statusMutationSchema)) }, requestId);
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
    await deletePage(current.user.id, input.id, input.updatedAt);
    return new Response(null, {
      status: 204,
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
    });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
