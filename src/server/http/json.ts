import { z } from 'zod';

import { HttpError } from './errors';

const MAX_JSON_BYTES = 1_000_000;
const MAX_JSON_DEPTH = 256;

export async function parseJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json' && !mediaType?.endsWith('+json')) {
    throw new HttpError(415, 'The request body must use JSON.');
  }

  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) {
    throw new HttpError(413, 'The request body is too large.');
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) {
    throw new HttpError(413, 'The request body is too large.');
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'The request body must be valid JSON.');
  }

  const pending: Array<{ depth: number; value: unknown }> = [{ depth: 0, value }];
  while (pending.length) {
    const current = pending.pop();
    if (!current) break;
    if (current.depth > MAX_JSON_DEPTH || (typeof current.value === 'number' && !Number.isFinite(current.value))) {
      throw new HttpError(400, 'The request body contains invalid JSON values.');
    }
    if (typeof current.value === 'object' && current.value !== null) {
      for (const child of Object.values(current.value)) {
        pending.push({ depth: current.depth + 1, value: child });
      }
    }
  }

  return schema.parse(value);
}
