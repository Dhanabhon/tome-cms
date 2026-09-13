import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';

import { FreshSessionRequiredError, requireFreshOwnerSession } from '../../../../server/auth/fresh-session';
import { assertSameOrigin } from '../../../../server/auth/origin';
import { enforceRateLimit, RateLimitExceededError } from '../../../../server/auth/rate-limit';
import { RecoveryCodeError, regenerateRecoveryCodes } from '../../../../server/auth/recovery';
import { HttpError, requireInstalledOwner } from '../../../../server/auth/session';
import { getServerEnv } from '../../../../server/env';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;

function problem(request: Request, status: number, title: string, detail: string, requestId: string): Response {
  return Response.json({ type: 'about:blank', title, status, detail, instance: new URL(request.url).pathname, requestId }, {
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/problem+json', 'X-Request-ID': requestId },
    status,
  });
}

export const POST: APIRoute = async ({ clientAddress, request }) => {
  const requestId = randomUUID();
  try {
    assertSameOrigin(request, configuredOrigin);
    await enforceRateLimit('recovery', clientAddress);
    const current = await requireInstalledOwner(request.headers);
    await requireFreshOwnerSession(current);
    const recoveryCodes = await regenerateRecoveryCodes(current.user.id);
    return Response.json({ recoveryCodes }, { headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId } });
  } catch (error) {
    if (error instanceof FreshSessionRequiredError) return problem(request, 403, 'Fresh verification required', error.message, requestId);
    if (error instanceof RateLimitExceededError) {
      const response = problem(request, 429, 'Too many requests', 'Try again later.', requestId);
      response.headers.set('Retry-After', String(error.retryAfter));
      return response;
    }
    if (error instanceof HttpError) return problem(request, error.status, 'Access denied', error.message, requestId);
    if (error instanceof RecoveryCodeError) return problem(request, 403, 'Access denied', 'Verify a Passkey and try again.', requestId);
    if (error instanceof Error && /origin/i.test(error.message)) {
      return problem(request, 403, 'Request forbidden', 'Request origin is not allowed.', requestId);
    }
    console.error('Recovery-code regeneration failed.', { requestId });
    return problem(request, 500, 'Recovery codes unavailable', 'Try again later.', requestId);
  }
};
