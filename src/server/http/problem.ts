import { randomUUID } from 'node:crypto';

import { ZodError } from 'zod';

import { problemDetailsSchema } from './public-schemas';
import { HttpError } from './errors';
import { logPublicRequest, safePathname } from './request-log';

export type PublicErrorStatus = 400 | 404 | 429 | 500 | 503;

const titles: Record<PublicErrorStatus, string> = {
  400: 'Bad Request',
  404: 'Not Found',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

export function problem(
  request: Request,
  status: PublicErrorStatus,
  detail: string,
  options: { cors?: boolean; error?: unknown; startedAt?: number } = {},
): Response {
  const requestId = randomUUID();
  const body = problemDetailsSchema.parse({
    type: 'about:blank',
    title: titles[status],
    status,
    detail,
    instance: safePathname(request),
    requestId,
  });
  logPublicRequest(request, requestId, status, options.startedAt, options.error);
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/problem+json; charset=utf-8',
    'Referrer-Policy': 'no-referrer',
    'X-Request-ID': requestId,
  });
  if (options.cors !== false) headers.set('Access-Control-Allow-Origin', '*');
  return new Response(JSON.stringify(body), { headers, status });
}

export function publicError(request: Request, error: unknown, startedAt?: number): Response {
  if (error instanceof ZodError) {
    return problem(request, 400, 'Check the request parameters and try again.', { error, startedAt });
  }
  if (error instanceof HttpError && [400, 404, 429, 503].includes(error.status)) {
    return problem(request, error.status as Exclude<PublicErrorStatus, 500>, error.message, { error, startedAt });
  }
  return problem(request, 500, 'The request could not be completed.', { error, startedAt });
}

export function privatePreviewError(request: Request, error: unknown, startedAt?: number): Response {
  const missing = error instanceof HttpError && error.status === 404;
  return problem(
    request,
    missing ? 404 : 500,
    missing ? 'Preview not found.' : 'The preview could not be loaded.',
    { cors: false, error, startedAt },
  );
}
