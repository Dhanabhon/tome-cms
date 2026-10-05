import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';
import { z } from 'zod';

import { assertSameOrigin } from '../../../server/auth/origin';
import { enforceRateLimit, RateLimitExceededError } from '../../../server/auth/rate-limit';
import { consumeRecoveryCode, RecoveryCodeError } from '../../../server/auth/recovery';
import { getSiteSettings } from '../../../server/content/site-settings';
import { getServerEnv } from '../../../server/env';
import { senderAddress } from '../../../server/http/sender-address';
import { guardSignIn } from '../../../server/plugins/sign-in';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;
const requestSchema = z.object({ code: z.string().trim().min(1).max(128) }).strict();

function problem(request: Request, status: number, title: string, detail: string, requestId: string, code?: string): Response {
  return Response.json({ type: 'about:blank', title, status, detail, instance: new URL(request.url).pathname, requestId, ...(code ? { code } : {}) }, {
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/problem+json', 'X-Request-ID': requestId },
    status,
  });
}

export const POST: APIRoute = async ({ clientAddress, request }) => {
  const requestId = randomUUID();
  try {
    assertSameOrigin(request, configuredOrigin);
    const sender = senderAddress(request, clientAddress);
    await enforceRateLimit('recovery', sender);
    // A recovery code is the one secret a person types, so the sign-in plugin stands here and not
    // in front of a passkey, which cannot be guessed. After the limit, so a flood never reaches
    // Cloudflare; before the code, so a refused attempt spends nothing.
    const settings = await getSiteSettings();
    if (settings) {
      const verdict = await guardSignIn({
        ownerId: settings.owner_id,
        remoteIp: sender,
        token: request.headers.get('X-TomeCMS-Plugin-Token'),
      });
      if (verdict?.outcome === 'refused') {
        // Cloudflare's reason codes, so the next refusal can be read from the log. Never the token.
        console.warn(`Recovery challenge refused [${verdict.pluginId}]: ${verdict.detail ?? 'no detail'}`);
        return problem(request, 403, 'Challenge not passed', 'The check before recovery was not passed.', requestId, 'challenge_refused');
      }
      if (verdict?.outcome === 'unavailable') {
        // Said out loud and let through: the third party is not the gate, and the limit above does not depend on it.
        console.warn(`Recovery challenge unavailable [${verdict.pluginId}]: ${verdict.detail ?? 'no detail'}`);
      }
    }
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
