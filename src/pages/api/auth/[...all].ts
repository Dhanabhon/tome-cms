import type { APIRoute } from 'astro';

import { auth } from '../../../server/auth/config';
import { EnrollmentContextError, verifyEnrollmentContext } from '../../../server/auth/context';
import {
  authorizeEnrollmentContext,
  classifyAuthIdentity,
} from '../../../server/auth/enrollment';
import { assertSameOrigin } from '../../../server/auth/origin';
import { enforceRateLimit, RateLimitExceededError, type RateLimitAction } from '../../../server/auth/rate-limit';
import { getServerEnv } from '../../../server/env';

const env = getServerEnv();
const configuredOrigin = new URL(env.TOME_CMS_PUBLIC_URL).origin;
const registrationOptionsPath = '/api/auth/passkey/generate-register-options';
const registrationVerificationPath = '/api/auth/passkey/verify-registration';
const recoveryContextHeader = 'X-TomeCMS-Recovery-Context';
const pendingSessionPaths = new Set([
  'GET /api/auth/get-session',
  'POST /api/auth/sign-out',
]);

async function rejectInvalidSession(headers: Headers): Promise<Response> {
  const responseHeaders = new Headers({ 'Cache-Control': 'no-store' });
  try {
    const signedOut = await auth.api.signOut({ asResponse: true, headers });
    for (const cookie of signedOut.headers.getSetCookie()) responseHeaders.append('Set-Cookie', cookie);
  } catch {
    // The database identity is already unusable; cookie cleanup is best-effort.
  }
  return Response.json({ error: 'The authentication session is no longer valid.' }, {
    headers: responseHeaders,
    status: 401,
  });
}

export const ALL: APIRoute = async (context) => {
  const { request } = context;
  try {
    assertSameOrigin(request, configuredOrigin);
  } catch {
    return Response.json({ error: 'Request origin is not allowed.' }, {
      headers: { 'Cache-Control': 'no-store' },
      status: 403,
    });
  }
  const url = new URL(request.url);
  const current = await auth.api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true, disableRefresh: true },
  });
  if (current) {
    const identity = await classifyAuthIdentity(current.user.id);
    if (identity === 'invalid') return rejectInvalidSession(request.headers);
    if (identity === 'pending-install' && !pendingSessionPaths.has(`${request.method} ${url.pathname}`)) {
      return Response.json({ error: 'This session is limited to installer finalization.' }, {
        headers: { 'Cache-Control': 'no-store' },
        status: 403,
      });
    }
  }

  let authRequest = request;
  // An enrollment registers the first Passkey, or the one replacing a Passkey that is gone.
  const enrolling = request.method === 'GET' && url.pathname === registrationOptionsPath && url.searchParams.has('context');
  if (enrolling) {
    try {
      const { reference } = await authorizeEnrollmentContext(url.searchParams.get('context'));
      url.searchParams.set('context', reference);
      authRequest = new Request(url, {
        headers: request.headers,
        method: request.method,
        signal: request.signal,
      });
    } catch (error) {
      if (!(error instanceof EnrollmentContextError)) throw error;
      return Response.json({ error: 'Enrollment context is invalid or expired.' }, {
        headers: { 'Cache-Control': 'no-store' },
        status: 400,
      });
    }
  }

  let action: RateLimitAction | undefined;
  if (request.method === 'POST' && url.pathname === '/api/auth/passkey/verify-authentication') {
    action = 'signin';
  } else if (request.method === 'POST' && url.pathname === registrationVerificationPath) {
    const recoveryContext = request.headers.get(recoveryContextHeader);
    action = current ? 'signin' : 'install';
    if (recoveryContext) {
      try {
        verifyEnrollmentContext(recoveryContext, 'recovery', env.TOME_CMS_CONTEXT_SECRET);
        action = 'recovery';
        const headers = new Headers(request.headers);
        headers.delete(recoveryContextHeader);
        authRequest = new Request(request, { headers });
      } catch {
        return Response.json({ error: 'Enrollment context is invalid or expired.' }, {
          headers: { 'Cache-Control': 'no-store' },
          status: 400,
        });
      }
    }
  }
  if (action) {
    try {
      await enforceRateLimit(action, context.clientAddress);
    } catch (error) {
      if (!(error instanceof RateLimitExceededError)) throw error;
      return Response.json({ error: 'Too many authentication attempts. Try again later.' }, {
        headers: {
          'Cache-Control': 'no-store',
          'Retry-After': String(error.retryAfter),
        },
        status: 429,
      });
    }
  }
  const response = await auth.handler(authRequest);
  if (!enrolling) return response;
  const { withoutExcludedCredentials } = await import('../../../server/auth/allowed-credentials');
  return withoutExcludedCredentials(response);
};
