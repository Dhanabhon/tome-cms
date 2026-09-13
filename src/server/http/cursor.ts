import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { getServerEnv } from '../env';
import { HttpError } from './errors';

const QUERY_CONTEXT = 'tomecms:content-cursor:v1:query\0';
const SIGNATURE_CONTEXT = 'tomecms:content-cursor:v1:signature\0';
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const INVALID_CURSOR = 'Invalid pagination cursor.';

const cursorClaimsSchema = z.object({
  v: z.literal(1),
  resource: z.enum(['posts', 'pages']),
  queryHash: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  publishedAt: z.iso.datetime({ offset: true }).refine((value) => new Date(value).toISOString() === value),
  id: z.uuid().refine((value) => value === value.toLowerCase()),
}).strict();

export type CursorClaims = z.infer<typeof cursorClaimsSchema>;
export type CursorQuery = Record<string, string | number | undefined>;

function hmac(context: string, value: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(context).update(value).digest();
}

function canonicalQuery(query: CursorQuery): string {
  const entries = Object.entries(query)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  for (const [key, value] of entries) {
    if (!key || /[\u0000-\u001f\u007f]/.test(key) || (typeof value === 'number' && !Number.isFinite(value))) {
      throw new Error('Cursor query values must be finite and named.');
    }
  }
  return JSON.stringify(entries);
}

function hashQuery(query: CursorQuery, secret: string): string {
  return hmac(QUERY_CONTEXT, canonicalQuery(query), secret).toString('base64url');
}

export function cursorQueryHash(query: CursorQuery): string {
  return hashQuery(query, getServerEnv().TOME_CMS_CONTEXT_SECRET);
}

function decodeBase64url(value: string): Buffer {
  if (!BASE64URL.test(value)) throw new Error(INVALID_CURSOR);
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) throw new Error(INVALID_CURSOR);
  return decoded;
}

export function encodeCursor(claims: CursorClaims): string {
  const secret = getServerEnv().TOME_CMS_CONTEXT_SECRET;
  const payload = Buffer.from(JSON.stringify(cursorClaimsSchema.parse(claims))).toString('base64url');
  const signature = hmac(SIGNATURE_CONTEXT, payload, secret).toString('base64url');
  return `${payload}.${signature}`;
}

export function decodeCursor(
  cursor: string,
  expected: { query: CursorQuery; resource: CursorClaims['resource'] },
): CursorClaims {
  const secret = getServerEnv().TOME_CMS_CONTEXT_SECRET;
  try {
    if (cursor.length > 2_048) throw new Error(INVALID_CURSOR);
    const parts = cursor.split('.');
    if (parts.length !== 2) throw new Error(INVALID_CURSOR);
    const [payload, encodedSignature] = parts;
    if (!payload || !encodedSignature) throw new Error(INVALID_CURSOR);

    const signature = decodeBase64url(encodedSignature);
    const wantedSignature = hmac(SIGNATURE_CONTEXT, payload, secret);
    if (signature.length !== wantedSignature.length || !timingSafeEqual(signature, wantedSignature)) {
      throw new Error(INVALID_CURSOR);
    }

    const claims = cursorClaimsSchema.parse(JSON.parse(decodeBase64url(payload).toString('utf8')));
    if (claims.resource !== expected.resource) throw new Error(INVALID_CURSOR);
    const wantedQueryHash = Buffer.from(hashQuery(expected.query, secret), 'base64url');
    const actualQueryHash = Buffer.from(claims.queryHash, 'base64url');
    if (actualQueryHash.length !== wantedQueryHash.length || !timingSafeEqual(actualQueryHash, wantedQueryHash)) {
      throw new Error(INVALID_CURSOR);
    }
    return claims;
  } catch {
    throw new HttpError(400, INVALID_CURSOR);
  }
}
