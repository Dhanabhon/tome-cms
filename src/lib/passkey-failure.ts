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
 * Most statuses mean the same thing wherever they appear, so they are mapped here.
 * Two do not, and the caller passes both in. What "something else went wrong" should
 * say depends on what was being attempted. So does 401: registering a spare needs the
 * session it was refused for, but a sign-in has no session to expire -- there, 401 is
 * better-auth answering that it does not know the credential the browser offered, and
 * saying "your session expired" sends the owner to reload a page that was never the
 * problem instead of to a Passkey that is registered.
 *
 * WebAuthn deliberately refuses to say whether a credential existed or the person
 * dismissed the prompt -- both arrive as NotAllowedError, and so as the same
 * ERROR_CEREMONY_ABORTED -- so nothing here tries to guess between them. The sign-in
 * fallback names both.
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

/** The authenticator's own verdict, which better-auth passes through beside the status. */
export function readPasskeyCode(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const source = value as Record<string, unknown>;
  const error = typeof source.error === 'object' && source.error !== null
    ? source.error as Record<string, unknown>
    : source;
  return typeof error.code === 'string' ? error.code : undefined;
}

export function describePasskeyFailure(value: unknown, copy: AdminCopy, fallback: string, unauthorized: string): string {
  // One WebAuthn refusal is unambiguous and worth naming: an authenticator that already holds
  // a Passkey for this account refuses to make a second one, which is what a spare is *for*.
  // It is not a fault to retry past -- the spare has to go somewhere else.
  if (readPasskeyCode(value) === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') return copy.auth.passkeyAlreadyOnDevice;
  const status = readPasskeyStatus(value);
  // 403 is this app's own origin guard rather than better-auth: the page was opened
  // at an address the server is not configured for, so every auth call is refused.
  if (status === 403) return copy.auth.originRejected;
  if (status === 429) return copy.auth.tooManyAttempts;
  if (status === 401) return unauthorized;
  if (status !== undefined && status >= 500) return copy.auth.serverError;
  return fallback;
}

/** A thrown failure means the request never landed, which for fetch is a TypeError. */
export function describePasskeyException(error: unknown, copy: AdminCopy, fallback: string): string {
  return error instanceof TypeError ? copy.auth.networkError : fallback;
}
