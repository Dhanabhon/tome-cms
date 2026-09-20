import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { getServerEnv } from '../env';

/**
 * A plugin's secret setting, at rest.
 *
 * This moves the problem rather than solving it: whoever holds both the database and the
 * environment holds the key as well. It is worth doing because they are not usually held
 * together -- a database backup travels to places an environment does not, and a secret
 * key for somebody else's service should not be readable in one.
 */
const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function key(): Buffer {
  return createHash('sha256').update(getServerEnv().TOME_CMS_CONTEXT_SECRET).digest();
}

export function sealSecret(value: string): string {
  // A fresh IV per value, so sealing one secret twice does not say that it is one secret.
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [VERSION, Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')].join('.');
}

/** Null for anything that is not a sealed value this build can open, including a tampered one. */
export function openSecret(sealed: string): string | null {
  const [version, payload] = sealed.split('.');
  if (version !== VERSION || !payload) return null;
  try {
    const raw = Buffer.from(payload, 'base64');
    if (raw.length <= IV_BYTES + TAG_BYTES) return null;
    const decipher = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, IV_BYTES));
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Whether a stored value is one at all, without opening it or saying what it is. */
export function isSealed(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(`${VERSION}.`) && value.length > VERSION.length + 1;
}

/** Constant-time compare, for a caller that has to check a secret it already holds. */
export function secretsMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
