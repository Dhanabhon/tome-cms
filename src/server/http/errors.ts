import { ZodError } from 'zod';

export type AdminErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 503;

export class HttpError extends Error {
  override name = 'HttpError';

  constructor(readonly status: AdminErrorStatus, message: string) {
    super(message);
  }
}

function postgresCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  return typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : null;
}

export function adminErrorResponse(error: unknown, requestId: string): Response {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message, requestId }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return Response.json({ error: 'Check the submitted fields and try again.', requestId }, { status: 400 });
  }
  if (postgresCode(error) === '23505') {
    return Response.json({ error: 'That value already exists.', requestId }, { status: 409 });
  }

  console.error(`Admin request failed [${requestId}] ${postgresCode(error) ? 'database_error' : 'unexpected_error'}`);
  return Response.json({ error: 'The request could not be completed.', requestId }, { status: 500 });
}
