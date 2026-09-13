import { createHash } from 'node:crypto';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Selectable } from 'kysely';
import { z } from 'zod';

import { ACCEPTED_IMAGE_TYPES, MAX_IMAGE_BYTES, type SupportedImageType } from '../../lib/media';
import { db } from '../db/client';
import type { MediaItemTable, MediaUploadReservationTable } from '../db/types';
import { HttpError } from '../http/errors';
import { inspectImage } from './image';
import { createObjectKey } from './keys';
import { s3, s3Bucket } from './storage';
import { stableMediaPath } from './url';

const checksumSha256 = z.string().regex(/^[A-Za-z0-9+/]{43}=$/);

export const reserveUploadSchema = z.object({
  originalName: z.string().trim().min(1).max(255),
  mimeType: z.enum(ACCEPTED_IMAGE_TYPES),
  sizeBytes: z.number().int().min(1).max(MAX_IMAGE_BYTES),
  checksumSha256,
  folderId: z.uuid().nullable(),
  altText: z.string().trim().max(300),
}).strict();

export const finalizeUploadSchema = z.object({}).strict();

export type ReserveUploadInput = z.infer<typeof reserveUploadSchema>;

export interface UploadReservationResponse {
  id: string;
  uploadUrl: string;
  expiresAt: string;
  headers: {
    'content-type': SupportedImageType;
    'x-amz-checksum-sha256': string;
  };
}

export interface ReadyMedia {
  id: string;
  folder_id: string | null;
  object_key: string;
  original_name: string;
  mime_type: SupportedImageType;
  size_bytes: number;
  checksum_sha256: string;
  width: number;
  height: number;
  alt_text: string | null;
  created_at: string;
  updated_at: string;
  stablePath: string;
}

class InvalidUploadError extends Error {
  constructor(message: string, readonly objectKey: string, readonly status: 400 | 409 = 400) {
    super(message);
  }
}

function readyMedia(row: Selectable<MediaItemTable>): ReadyMedia {
  const size = Number(row.size_bytes);
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_IMAGE_BYTES) throw new Error('Stored media size is invalid.');
  return {
    id: row.id,
    folder_id: row.folder_id,
    object_key: row.object_key,
    original_name: row.original_name,
    mime_type: row.mime_type,
    size_bytes: size,
    checksum_sha256: row.checksum_sha256,
    width: row.width,
    height: row.height,
    alt_text: row.alt_text,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    stablePath: stableMediaPath(row.id),
  };
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return candidate.name === 'NoSuchKey' || candidate.name === 'NotFound' || candidate.$metadata?.httpStatusCode === 404;
}

async function readObjectBody(body: GetObjectCommandOutput['Body'], maximum: number, objectKey: string): Promise<Buffer> {
  if (!body || !(Symbol.asyncIterator in body)) throw new Error('Object body is unavailable.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > maximum) throw new InvalidUploadError('The uploaded object is larger than declared.', objectKey);
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, size);
}

async function expireInvalidReservation(ownerId: string, reservationId: string, objectKey: string): Promise<void> {
  await Promise.allSettled([s3.send(new DeleteObjectCommand({ Bucket: s3Bucket, Key: objectKey }))]);
  await db.updateTable('media_upload_reservations').set({ state: 'expired' })
    .where('id', '=', reservationId).where('owner_id', '=', ownerId).where('state', '=', 'pending').execute();
}

export async function reserveUpload(ownerId: string, input: ReserveUploadInput): Promise<UploadReservationResponse> {
  if (input.folderId) {
    const folder = await db.selectFrom('media_folders').select('id')
      .where('id', '=', input.folderId).where('owner_id', '=', ownerId).executeTakeFirst();
    if (!folder) throw new HttpError(400, 'Choose a folder from this site.');
  }
  const objectKey = createObjectKey(ownerId, input.mimeType);
  const expiresAt = new Date(Date.now() + 300_000);
  const reservation = await db.insertInto('media_upload_reservations').values({
    owner_id: ownerId,
    folder_id: input.folderId,
    object_key: objectKey,
    original_name: input.originalName,
    mime_type: input.mimeType,
    expected_size_bytes: input.sizeBytes,
    expected_checksum_sha256: input.checksumSha256,
    alt_text: input.altText || null,
    state: 'pending',
    expires_at: expiresAt,
    finalized_at: null,
  }).returning('id').executeTakeFirstOrThrow();
  const command = new PutObjectCommand({
    Bucket: s3Bucket,
    Key: objectKey,
    ContentType: input.mimeType,
    ChecksumSHA256: input.checksumSha256,
  });
  try {
    const uploadUrl = await getSignedUrl(s3, command, {
      expiresIn: 300,
      signableHeaders: new Set(['content-type']),
      unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
    });
    return {
      id: reservation.id,
      uploadUrl,
      expiresAt: expiresAt.toISOString(),
      headers: { 'content-type': input.mimeType, 'x-amz-checksum-sha256': input.checksumSha256 },
    };
  } catch {
    await db.updateTable('media_upload_reservations').set({ state: 'expired' })
      .where('id', '=', reservation.id).where('state', '=', 'pending').execute();
    throw new HttpError(503, 'Storage is temporarily unavailable. Try the upload again.');
  }
}

export async function finalizeUpload(ownerId: string, reservationId: string): Promise<ReadyMedia> {
  try {
    return await db.transaction().execute(async (trx) => {
      const reservation = await trx.selectFrom('media_upload_reservations').selectAll()
        .where('id', '=', reservationId).where('owner_id', '=', ownerId).forUpdate().executeTakeFirst();
      if (!reservation) throw new HttpError(404, 'Upload reservation not found.');
      if (reservation.state !== 'pending') throw new HttpError(409, 'This upload reservation is no longer active.');
      if (reservation.expires_at.getTime() <= Date.now()) {
        throw new InvalidUploadError('The upload reservation expired. Upload the file again.', reservation.object_key, 409);
      }

      let head;
      try {
        head = await s3.send(new HeadObjectCommand({ Bucket: s3Bucket, Key: reservation.object_key, ChecksumMode: 'ENABLED' }));
      } catch (error) {
        if (isNotFound(error)) {
          throw new InvalidUploadError('The uploaded object was not found. Upload the file again.', reservation.object_key, 409);
        }
        throw new HttpError(503, 'Storage verification is temporarily unavailable. Try finalizing again.');
      }
      const expectedSize = Number(reservation.expected_size_bytes);
      if (head.ContentLength !== expectedSize || head.ContentType !== reservation.mime_type
        || (head.ChecksumSHA256 && head.ChecksumSHA256 !== reservation.expected_checksum_sha256)) {
        throw new InvalidUploadError('The uploaded object does not match its reservation.', reservation.object_key);
      }

      let body: Buffer;
      try {
        const object = await s3.send(new GetObjectCommand({ Bucket: s3Bucket, Key: reservation.object_key, ChecksumMode: 'ENABLED' }));
        body = await readObjectBody(object.Body, expectedSize, reservation.object_key);
      } catch (error) {
        if (error instanceof InvalidUploadError) throw error;
        throw new HttpError(503, 'Storage verification is temporarily unavailable. Try finalizing again.');
      }
      const checksum = createHash('sha256').update(body).digest('base64');
      if (body.length !== expectedSize || checksum !== reservation.expected_checksum_sha256) {
        throw new InvalidUploadError('The uploaded object checksum or size is invalid.', reservation.object_key);
      }

      let dimensions: { height: number; width: number };
      try {
        dimensions = await inspectImage(body, reservation.mime_type);
      } catch {
        throw new InvalidUploadError('The uploaded object is not a valid supported image.', reservation.object_key);
      }
      const item = await trx.insertInto('media_items').values({
        id: reservation.id,
        owner_id: ownerId,
        folder_id: reservation.folder_id,
        object_key: reservation.object_key,
        original_name: reservation.original_name,
        mime_type: reservation.mime_type,
        size_bytes: expectedSize,
        checksum_sha256: reservation.expected_checksum_sha256,
        width: dimensions.width,
        height: dimensions.height,
        alt_text: reservation.alt_text,
        state: 'ready',
        delete_error_code: null,
      }).returningAll().executeTakeFirstOrThrow();
      await trx.updateTable('media_upload_reservations')
        .set({ state: 'finalized', finalized_at: new Date() })
        .where('id', '=', reservation.id).where('state', '=', 'pending').executeTakeFirstOrThrow();
      return readyMedia(item);
    });
  } catch (error) {
    if (error instanceof InvalidUploadError) {
      await expireInvalidReservation(ownerId, reservationId, error.objectKey);
      throw new HttpError(error.status, error.message);
    }
    throw error;
  }
}
