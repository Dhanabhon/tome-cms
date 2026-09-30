import { GetObjectCommand } from '@aws-sdk/client-s3';

import { db } from '../db/client';
import { HttpError } from '../http/errors';
import { checkRange } from './range';
import { s3, s3Bucket } from './storage';

function storageStatus(error: unknown): unknown {
  return (error as { $metadata?: { httpStatusCode?: unknown } } | null)?.$metadata?.httpStatusCode;
}

/** 416 names the file's size, so a reader can ask again for a range it has. */
function refusedRange(size: string, requestId: string | undefined): Response {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store', 'Content-Range': `bytes */${size}` };
  if (requestId) headers['X-Request-ID'] = requestId;
  return Response.json({ error: 'The requested range is not valid.', ...(requestId ? { requestId } : {}) }, { headers, status: 416 });
}

/**
 * One of the owner's ready PDFs, streamed from storage through the app's own client, so the
 * admin's pdf.js reads it from the admin's address and not the media host's. Only PDFs: the
 * thumbnail is all this is for, and another type would be a file the owner cannot otherwise open inline.
 * A Range goes to storage as it came, and storage's answer to it is the answer: pdf.js asks for
 * the end of the file and for the first page, and never downloads the rest. `signal` is the
 * request's: a reader that leaves before storage answers stops the read instead of pulling the object.
 */
export async function readPdf(
  ownerId: string,
  id: string,
  range: string | null,
  { requestId, signal }: { requestId?: string; signal?: AbortSignal } = {},
): Promise<Response> {
  const item = await db.selectFrom('media_items').select(['object_key', 'size_bytes'])
    .where('id', '=', id).where('owner_id', '=', ownerId).where('state', '=', 'ready').where('mime_type', '=', 'application/pdf')
    .executeTakeFirst();
  if (!item) throw new HttpError(404, 'File not found.');
  const asked = checkRange(range);
  if (asked === 'malformed') return refusedRange(item.size_bytes, requestId);
  try {
    const object = await s3.send(
      new GetObjectCommand({ Bucket: s3Bucket, Key: item.object_key, ...(range ? { Range: range } : {}) }),
      { abortSignal: signal },
    );
    if (!object.Body) throw new Error('Object body is unavailable.');
    const partial = asked === 'range' && object.ContentRange;
    const headers = new Headers({
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=300',
      'Content-Disposition': 'inline',
      'Content-Type': 'application/pdf',
      'X-Content-Type-Options': 'nosniff',
    });
    if (requestId) headers.set('X-Request-ID', requestId);
    if (object.ContentLength !== undefined) headers.set('Content-Length', String(object.ContentLength));
    if (partial) headers.set('Content-Range', object.ContentRange!);
    return new Response(object.Body.transformToWebStream(), { headers, status: partial ? 206 : 200 });
  } catch (error) {
    const status = storageStatus(error);
    if (status === 404) throw new HttpError(404, 'File not found.');
    if (status === 416) return refusedRange(item.size_bytes, requestId);
    // A reader that left is not a failure of storage.
    if (!signal?.aborted) console.error('PDF read failed:', typeof status === 'number' ? status : 'no status');
    throw new HttpError(503, 'The file is temporarily unavailable.');
  }
}
