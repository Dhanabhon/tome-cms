import { createHash, randomUUID } from 'node:crypto';

import { logPublicRequest } from './request-log';

interface PublicJsonOptions {
  lastModified: Date;
  maxAge?: number;
  startedAt?: number;
}

function matchesEtag(header: string, etag: string): boolean {
  return header.split(',').some((candidate) => {
    const value = candidate.trim();
    return value === '*' || value === etag || value === `W/${etag}`;
  });
}

function commonPublicHeaders(requestId: string, etag: string, lastModified: Date, maxAge: number): Headers {
  return new Headers({
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 5}`,
    ETag: etag,
    'Last-Modified': lastModified.toUTCString(),
    'X-Request-ID': requestId,
  });
}

export function publicJson(request: Request, value: unknown, options: PublicJsonOptions): Response {
  const maxAge = options.maxAge ?? 60;
  if (!Number.isSafeInteger(maxAge) || maxAge < 0 || Number.isNaN(options.lastModified.getTime())) {
    throw new Error('Public cache options are invalid.');
  }
  const requestId = randomUUID();
  const body = JSON.stringify(value);
  const etag = `"${createHash('sha256').update(body).digest('base64url')}"`;
  const headers = commonPublicHeaders(requestId, etag, options.lastModified, maxAge);
  const ifNoneMatch = request.headers.get('if-none-match');
  const modifiedSince = ifNoneMatch === null ? Date.parse(request.headers.get('if-modified-since') ?? '') : Number.NaN;
  const notModified = ifNoneMatch !== null
    ? matchesEtag(ifNoneMatch, etag)
    : Number.isFinite(modifiedSince)
      && Math.floor(options.lastModified.getTime() / 1_000) <= Math.floor(modifiedSince / 1_000);
  const status = notModified ? 304 : 200;
  if (!notModified) headers.set('Content-Type', 'application/json; charset=utf-8');
  logPublicRequest(request, requestId, status, options.startedAt);
  return new Response(notModified ? null : body, { headers, status });
}

export function privatePreviewJson(request: Request, value: unknown, startedAt?: number): Response {
  const requestId = randomUUID();
  logPublicRequest(request, requestId, 200, startedAt);
  return new Response(JSON.stringify(value), {
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Request-ID': requestId,
    },
  });
}

export function publicOptions(request: Request, startedAt = performance.now()): Response {
  const requestId = randomUUID();
  logPublicRequest(request, requestId, 204, startedAt);
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Headers': 'If-Modified-Since, If-None-Match',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Max-Age': '86400',
      Allow: 'GET, OPTIONS',
      'Cache-Control': 'public, max-age=86400',
      'X-Request-ID': requestId,
    },
    status: 204,
  });
}

export function nextPublicUrl(requestUrl: string, cursor: string | null): string | null {
  if (!cursor) return null;
  const url = new URL(requestUrl);
  url.searchParams.set('cursor', cursor);
  return url.toString();
}
