import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';

import { assertSameOrigin } from '../../../../server/auth/origin';
import { requireInstalledOwner } from '../../../../server/auth/session';
import { getServerEnv } from '../../../../server/env';
import { adminErrorResponse, HttpError } from '../../../../server/http/errors';
import { parseJson } from '../../../../server/http/json';
import {
  createFolder,
  deleteFolder,
  listFolders,
  mediaFolderCreateSchema,
  mediaFolderDeleteSchema,
  mediaFolderUpdateSchema,
  renameFolder,
} from '../../../../server/media/service';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;

function guard(request: Request): void {
  try {
    assertSameOrigin(request, configuredOrigin);
  } catch {
    throw new HttpError(403, 'Request origin is not allowed.');
  }
}

function success(body: unknown, requestId: string, status = 200): Response {
  return Response.json(body, { headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId }, status });
}

export const GET: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    guard(request);
    return success({ folders: await listFolders(current.user.id) }, requestId);
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    guard(request);
    const input = await parseJson(request, mediaFolderCreateSchema);
    return success({ folder: await createFolder(current.user.id, input.name) }, requestId, 201);
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};

export const PUT: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    guard(request);
    const input = await parseJson(request, mediaFolderUpdateSchema);
    return success({ folder: await renameFolder(current.user.id, input.id, input.name) }, requestId);
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    guard(request);
    const input = await parseJson(request, mediaFolderDeleteSchema);
    await deleteFolder(current.user.id, input.id);
    return success({ deleted: true }, requestId);
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
