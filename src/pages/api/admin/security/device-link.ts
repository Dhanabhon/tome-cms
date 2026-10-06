import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';

import { cancelDeviceEnrollments, issueDeviceEnrollment } from '../../../../server/auth/device-link';
import { requireFreshOwnerSession } from '../../../../server/auth/fresh-session';
import { assertSameOrigin } from '../../../../server/auth/origin';
import { enforceRateLimit, RateLimitExceededError } from '../../../../server/auth/rate-limit';
import { HttpError, requireInstalledOwner } from '../../../../server/auth/session';
import { getServerEnv } from '../../../../server/env';
import { senderAddress } from '../../../../server/http/sender-address';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;

function problem(request: Request, status: number, title: string, detail: string, requestId: string): Response {
  return Response.json({ type: 'about:blank', title, status, detail, instance: new URL(request.url).pathname, requestId }, {
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/problem+json', 'X-Request-ID': requestId },
    status,
  });
}

async function mutationGuard(request: Request, clientAddress: string): Promise<void> {
  assertSameOrigin(request, configuredOrigin);
  await enforceRateLimit('signin', senderAddress(request, clientAddress));
}

function handleError(request: Request, error: unknown, requestId: string): Response {
  if (error instanceof RateLimitExceededError) {
    const response = problem(request, 429, 'Too many requests', 'Try again later.', requestId);
    response.headers.set('Retry-After', String(error.retryAfter));
    return response;
  }
  if (error instanceof HttpError) return problem(request, error.status, 'Access denied', error.message, requestId);
  if (error instanceof Error && /origin/i.test(error.message)) {
    return problem(request, 403, 'Request forbidden', 'Request origin is not allowed.', requestId);
  }
  console.error('Device link request failed.', { requestId });
  return problem(request, 500, 'Device link request failed', 'Try again later.', requestId);
}

export const POST: APIRoute = async ({ clientAddress, request }) => {
  const requestId = randomUUID();
  try {
    await mutationGuard(request, clientAddress);
    const current = await requireInstalledOwner(request.headers);
    // A link adds a credential, so it asks for the same recent check as a spare.
    await requireFreshOwnerSession(current);
    const { context, expiresAt } = await issueDeviceEnrollment(current.user.id);
    const url = `${configuredOrigin}/add-device?context=${encodeURIComponent(context)}`;
    // The screen counts down from the time left rather than from expiresAt, so a device whose clock
    // is off still shows the link for as long as the server will take it.
    const expiresInSeconds = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1_000));
    return Response.json({ url, expiresAt: expiresAt.toISOString(), expiresInSeconds }, {
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
    });
  } catch (error) {
    return handleError(request, error, requestId);
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    // Cancelling can only spend a link, so it does not draw on the owner's sign-in budget.
    assertSameOrigin(request, configuredOrigin);
    const current = await requireInstalledOwner(request.headers);
    // Cancelling only takes power away, so an older session may do it.
    await cancelDeviceEnrollments(current.user.id);
    return Response.json({ cancelled: true }, { headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId } });
  } catch (error) {
    return handleError(request, error, requestId);
  }
};
