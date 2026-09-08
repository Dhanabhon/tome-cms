import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

export const ENROLLMENT_TTL_SECONDS = 10 * 60;

export type EnrollmentPurpose = 'install' | 'recovery';

const claimsSchema = z.object({
  v: z.literal(1),
  id: z.uuid(),
  purpose: z.enum(['install', 'recovery']),
  exp: z.number().int().positive(),
}).strict();

export type EnrollmentClaims = z.infer<typeof claimsSchema>;

const INVALID_CONTEXT = 'Enrollment context is invalid or expired.';
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function decodeBase64url(value: string): Buffer {
  if (!BASE64URL.test(value)) throw new Error(INVALID_CONTEXT);
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) throw new Error(INVALID_CONTEXT);
  return decoded;
}

export function signEnrollmentContext(claims: EnrollmentClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claimsSchema.parse(claims))).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyEnrollmentContext(
  context: string,
  purpose: EnrollmentPurpose | undefined,
  secret: string,
  now = new Date(),
): EnrollmentClaims {
  try {
    if (context.length > 2_048) throw new Error(INVALID_CONTEXT);
    const parts = context.split('.');
    if (parts.length !== 2) throw new Error(INVALID_CONTEXT);
    const [payload, encodedSignature] = parts;
    if (!payload || !encodedSignature) throw new Error(INVALID_CONTEXT);

    const signature = decodeBase64url(encodedSignature);
    const expected = createHmac('sha256', secret).update(payload).digest();
    if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) {
      throw new Error(INVALID_CONTEXT);
    }

    const claims = claimsSchema.parse(JSON.parse(decodeBase64url(payload).toString('utf8')));
    if (purpose && claims.purpose !== purpose) throw new Error(INVALID_CONTEXT);
    if (claims.exp <= Math.floor(now.getTime() / 1_000)) throw new Error(INVALID_CONTEXT);
    return claims;
  } catch {
    throw new Error(INVALID_CONTEXT);
  }
}

export function hashEnrollmentContext(context: string): string {
  return createHash('sha256').update(context).digest('hex');
}
