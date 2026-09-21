import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';

import { assertSameOrigin } from '../../../../server/auth/origin';
import { requireInstalledOwner } from '../../../../server/auth/session';
import { removeBrandImage, storeBrandImage } from '../../../../server/content/brand';
import { getServerEnv } from '../../../../server/env';
import { adminErrorResponse, HttpError } from '../../../../server/http/errors';
import { BRAND_KINDS, MAX_BRAND_BYTES, type BrandKind } from '../../../../server/media/brand-image';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;
const headers = (requestId: string) => ({ 'Cache-Control': 'no-store', 'X-Request-ID': requestId });

async function owner(request: Request) {
  const current = await requireInstalledOwner(request.headers);
  try {
    assertSameOrigin(request, configuredOrigin);
  } catch {
    throw new HttpError(403, 'Request origin is not allowed.');
  }
  return current;
}

function kindOf(value: string | undefined): BrandKind {
  if (!value || !(BRAND_KINDS as readonly string[]).includes(value)) throw new HttpError(404, 'Not found.');
  return value as BrandKind;
}

/** The body, read no further than a brand file may weigh. */
async function readFile(request: Request): Promise<Buffer> {
  const tooLarge = () => new HttpError(413, 'The file is larger than 1 MB.', { code: 'brand_too_large' });
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BRAND_BYTES) throw tooLarge();
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(415, 'Choose a file.', { code: 'brand_type' });
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BRAND_BYTES) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export const POST: APIRoute = async ({ params, request }) => {
  const requestId = randomUUID();
  try {
    const current = await owner(request);
    const result = await storeBrandImage(current.user.id, kindOf(params.kind), await readFile(request));
    return Response.json(result, { headers: headers(requestId) });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};

export const DELETE: APIRoute = async ({ params, request }) => {
  const requestId = randomUUID();
  try {
    const current = await owner(request);
    return Response.json(await removeBrandImage(current.user.id, kindOf(params.kind)), { headers: headers(requestId) });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
