import type { AdminCopy } from './admin-i18n';

/**
 * Turns a passkey failure into the sentence that describes it.
 *
 * Every one of these flows used to discard the result and print a single line, so
 * five unrelated causes -- a rejected origin, a rate limit, an expired session, a
 * server fault, and the authenticator itself -- all read as "no Passkey was
 * accepted". The owner could not tell whether the fault was theirs, the browser's
 * or the server's, and the first three are fixable in seconds once named.
 *
 * The statuses mean the same thing wherever they appear, so they are mapped here.
 * What "something else went wrong" should say does not: signing in, adding a spare
 * and enrolling a recovery key each need their own sentence, so the caller passes
 * that one in.
 *
 * WebAuthn deliberately refuses to say whether a credential existed or the person
 * dismissed the prompt -- both arrive as NotAllowedError with status 400 -- so
 * nothing here tries to guess between them. The sign-in fallback names both.
 */
export function readPasskeyStatus(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const source = value as Record<string, unknown>;
  // A refused request arrives as { error: { status } }; better-auth also hands back
  // the bare response object on some paths, which carries status at the top level.
  const error = typeof source.error === 'object' && source.error !== null
    ? source.error as Record<string, unknown>
    : source;
  return typeof error.status === 'number' ? error.status : undefined;
}

export function describePasskeyFailure(value: unknown, copy: AdminCopy, fallback: string): string {
  const status = readPasskeyStatus(value);
  // 403 is this app's own origin guard rather than better-auth: the page was opened
  // at an address the server is not configured for, so every auth call is refused.
  if (status === 403) return copy.auth.originRejected;
  if (status === 429) return copy.auth.tooManyAttempts;
  if (status === 401) return copy.auth.sessionExpired;
  if (status !== undefined && status >= 500) return copy.auth.serverError;
  return fallback;
}

/** A thrown failure means the request never landed, which for fetch is a TypeError. */
export function describePasskeyException(error: unknown, copy: AdminCopy, fallback: string): string {
  return error instanceof TypeError ? copy.auth.networkError : fallback;
}
