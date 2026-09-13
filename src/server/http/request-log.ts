import { ZodError } from 'zod';

import { HttpError } from './errors';

function errorClass(error: unknown, status: number): string | null {
  if (error instanceof ZodError) return 'validation_error';
  if (error instanceof HttpError) return `http_${error.status}`;
  if (typeof error === 'object' && error !== null && 'code' in error
    && typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)) return 'database_error';
  if (error !== undefined) return 'unexpected_error';
  return status >= 400 ? 'http_error' : null;
}

function safePathname(request: Request): string {
  const segments = new URL(request.url).pathname.split('/');
  const preview = segments.lastIndexOf('preview');
  if (preview >= 0 && segments[preview + 1]) segments[preview + 1] = '[redacted]';
  return segments.join('/') || '/';
}

export function logPublicRequest(
  request: Request,
  requestId: string,
  status: number,
  startedAt = performance.now(),
  error?: unknown,
): void {
  const entry = {
    requestId,
    method: request.method,
    pathname: safePathname(request),
    status,
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    errorClass: errorClass(error, status),
  };
  try {
    console.info(JSON.stringify(entry));
  } catch {
    // Logging must never replace the HTTP response.
  }
}
