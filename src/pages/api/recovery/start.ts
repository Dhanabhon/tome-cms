import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';
import { z } from 'zod';

import { assertSameOrigin } from '../../../server/auth/origin';
import { enforceRateLimit, RateLimitExceededError } from '../../../server/auth/rate-limit';
import { consumeRecoveryCode, RecoveryCodeError } from '../../../server/auth/recovery';
import { getServerEnv } from '../../../server/env';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;
const requestSchema = z.object({ code: z.string().trim().min(1).max(128) }).strict();

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
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return problem(request, 400, 'Recovery failed', 'Check the recovery code and try again.', requestId);
    }
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) return problem(request, 400, 'Recovery failed', 'Check the recovery code and try again.', requestId);
    const enrollment = await consumeRecoveryCode(parsed.data.code);
    return Response.json({ context: enrollment.context, expiresAt: enrollment.expiresAt }, {
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
    });
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      const response = problem(request, 429, 'Too many requests', 'Try again later.', requestId);
      response.headers.set('Retry-After', String(error.retryAfter));
      return response;
    }
    if (error instanceof RecoveryCodeError) {
      return problem(request, 400, 'Recovery failed', 'Check the recovery code and try again.', requestId);
    }
    if (error instanceof Error && /origin/i.test(error.message)) {
      return problem(request, 403, 'Request forbidden', 'Request origin is not allowed.', requestId);
    }
    console.error('Recovery start failed.', { requestId });
    return problem(request, 500, 'Recovery unavailable', 'Try again later.', requestId);
  }
};
