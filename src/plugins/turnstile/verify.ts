import type { SignInVerdict } from '../contract';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 5_000;

/**
 * Which of Cloudflare's complaints are about the visitor.
 *
 * The rest -- a secret key that is wrong or missing, a malformed request, a fault on their
 * side -- are about this installation or about Cloudflare, and the person trying to sign in
 * can do nothing about any of them. Refusing them would mean that mistyping a secret key
 * locks the owner out of their own site until they reach a shell, which is the failure this
 * whole design is arranged around.
 */
const VISITOR_FAULTS = new Set([
  'invalid-input-response',
  'missing-input-response',
  'timeout-or-duplicate',
]);

export async function verifyTurnstileToken(input: {
  remoteIp: string | null;
  secret: string;
  token: string;
}): Promise<SignInVerdict> {
  const body = new FormData();
  body.set('secret', input.secret);
  body.set('response', input.token);
  if (input.remoteIp) body.set('remoteip', input.remoteIp);

  let response: Response;
  try {
    response = await fetch(SITEVERIFY, { body, method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    // Unreachable, refused, or slower than the timeout. Not the visitor's doing.
    return { outcome: 'unavailable', detail: error instanceof Error ? error.name : 'fetch failed' };
  }
  if (!response.ok) return { outcome: 'unavailable', detail: `siteverify ${response.status}` };

  const payload: unknown = await response.json().catch(() => null);
  if (typeof payload !== 'object' || payload === null) return { outcome: 'unavailable', detail: 'unreadable answer' };
  const { success, 'error-codes': codes } = payload as { 'error-codes'?: unknown; success?: unknown };
  if (success === true) return { outcome: 'passed' };

  const reasons = Array.isArray(codes) ? codes.filter((code): code is string => typeof code === 'string') : [];
  return reasons.some((code) => VISITOR_FAULTS.has(code))
    ? { outcome: 'refused', detail: reasons.join(', ') }
    : { outcome: 'unavailable', detail: reasons.join(', ') || 'refused without a reason' };
}
