import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 32 random bytes, as handed out: a code, an access token or a refresh token. */
export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** What is stored instead of a secret, as preview tokens do. */
export function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** RFC 7636 S256. A verifier is 43 to 128 characters of the unreserved set. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const computed = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}
