import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';
import { z } from 'zod';

import { assertSameOrigin } from '../../../../server/auth/origin';
import { enforceRateLimit, RateLimitExceededError } from '../../../../server/auth/rate-limit';
import { HttpError, requireInstalledOwner } from '../../../../server/auth/session';
import { db } from '../../../../server/db/client';
import { getServerEnv } from '../../../../server/env';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;
const renameSchema = z.object({ id: z.string().min(1).max(256), name: z.string().trim().min(1).max(80) }).strict();
const deleteSchema = z.object({ id: z.string().min(1).max(256) }).strict();

class PasskeyRequestError extends Error {
  constructor(readonly status: 400 | 404 | 409, message: string) {
    super(message);
  }
}

function problem(request: Request, status: number, title: string, detail: string, requestId: string): Response {
  return Response.json({ type: 'about:blank', title, status, detail, instance: new URL(request.url).pathname, requestId }, {
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/problem+json', 'X-Request-ID': requestId },
    status,
  });
}

async function parseBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new PasskeyRequestError(400, 'Request body must be valid JSON.');
  }
}

async function mutationGuard(request: Request, clientAddress: string): Promise<void> {
  assertSameOrigin(request, configuredOrigin);
  await enforceRateLimit('signin', clientAddress);
}

function handleError(request: Request, error: unknown, requestId: string): Response {
  if (error instanceof RateLimitExceededError) {
    const response = problem(request, 429, 'Too many requests', 'Try again later.', requestId);
    response.headers.set('Retry-After', String(error.retryAfter));
    return response;
  }
  if (error instanceof HttpError) return problem(request, error.status, 'Access denied', error.message, requestId);
  if (error instanceof PasskeyRequestError) return problem(request, error.status, 'Passkey request failed', error.message, requestId);
  if (error instanceof Error && /origin/i.test(error.message)) {
    return problem(request, 403, 'Request forbidden', 'Request origin is not allowed.', requestId);
  }
  console.error('Passkey security request failed.', { requestId });
  return problem(request, 500, 'Passkey request failed', 'Try again later.', requestId);
}

export const GET: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    assertSameOrigin(request, configuredOrigin);
    const current = await requireInstalledOwner(request.headers);
    const passkeys = await db.selectFrom('passkey')
      .select(['id', 'name', 'createdAt', 'last_used_at'])
      .where('userId', '=', current.user.id)
      .orderBy('createdAt', 'asc')
      .execute();
    return Response.json({ passkeys: passkeys.map((passkey) => ({
      id: passkey.id,
      name: passkey.name ?? 'Passkey',
      createdAt: passkey.createdAt,
      lastUsedAt: passkey.last_used_at,
    })) }, { headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId } });
  } catch (error) {
    return handleError(request, error, requestId);
  }
};

export const PATCH: APIRoute = async ({ clientAddress, request }) => {
  const requestId = randomUUID();
  try {
    await mutationGuard(request, clientAddress);
    const current = await requireInstalledOwner(request.headers);
    const parsed = renameSchema.safeParse(await parseBody(request));
    if (!parsed.success) throw new PasskeyRequestError(400, 'Choose a Passkey and enter a name up to 80 characters.');
    const updated = await db.updateTable('passkey')
      .set({ name: parsed.data.name })
      .where('id', '=', parsed.data.id)
      .where('userId', '=', current.user.id)
      .returning(['id', 'name'])
      .executeTakeFirst();
    if (!updated) throw new PasskeyRequestError(404, 'Passkey was not found.');
    return Response.json({ passkey: updated }, { headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId } });
  } catch (error) {
    return handleError(request, error, requestId);
  }
};

export const DELETE: APIRoute = async ({ clientAddress, request }) => {
  const requestId = randomUUID();
  try {
    await mutationGuard(request, clientAddress);
    const current = await requireInstalledOwner(request.headers);
    const parsed = deleteSchema.safeParse(await parseBody(request));
    if (!parsed.success) throw new PasskeyRequestError(400, 'Choose a valid Passkey.');

    await db.transaction().execute(async (trx) => {
      await trx.selectFrom('user').select('id').where('id', '=', current.user.id).forUpdate().executeTakeFirstOrThrow();
      const passkeys = await trx.selectFrom('passkey')
        .select('id')
        .where('userId', '=', current.user.id)
        .forUpdate()
        .execute();
      if (!passkeys.some(({ id }) => id === parsed.data.id)) throw new PasskeyRequestError(404, 'Passkey was not found.');
      if (passkeys.length < 2) throw new PasskeyRequestError(409, 'Add another Passkey before deleting this one.');
      await trx.deleteFrom('passkey')
        .where('id', '=', parsed.data.id)
        .where('userId', '=', current.user.id)
        .executeTakeFirstOrThrow();
    });

    return Response.json({ deleted: true }, { headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId } });
  } catch (error) {
    return handleError(request, error, requestId);
  }
};
