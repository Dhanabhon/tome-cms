import { createHash } from 'node:crypto';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import { z } from 'zod';

import {
  ACCEPTED_DOCUMENT_TYPES,
  ACCEPTED_IMAGE_TYPES,
  ACCEPTED_MEDIA_TYPES,
  documentExtension,
  documentLabel,
  documentTypeForName,
  isDocumentType,
  isImageType,
  MAX_DOCUMENT_FILE_BYTES,
  MAX_IMAGE_BYTES,
  MEDIA_TYPE_FILTERS,
  typesForFilter,
  type MediaKind,
  type SupportedDocumentType,
  type SupportedImageType,
  type SupportedMediaType,
} from '../../lib/media';
import { db } from '../db/client';
import type { Database, MediaFolderTable, MediaItemTable } from '../db/types';
import { HttpError } from '../http/errors';
import { contentDisposition } from './disposition';
import { documentRefusal, isTextDocument, readDocument, type DocumentRefusal } from './document';
import { inspectImage } from './image';
import { createObjectKey } from './keys';
import { s3, s3Bucket } from './storage';
import { stableMediaPath } from './url';

const checksumSha256 = z.string().regex(/^[A-Za-z0-9+/]{43}=$/);

export const reserveUploadSchema = z.object({
  originalName: z.string().trim().min(1).max(255),
  mimeType: z.enum(ACCEPTED_MEDIA_TYPES),
  sizeBytes: z.number().int().min(1).max(MAX_DOCUMENT_FILE_BYTES),
  checksumSha256,
  folderId: z.uuid().nullable(),
  altText: z.string().trim().max(300),
}).strict();

export const finalizeUploadSchema = z.object({}).strict();
export const mediaListInputSchema = z.object({
  folderId: z.uuid().nullable().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  search: z.string().trim().max(100).default(''),
  type: z.enum(MEDIA_TYPE_FILTERS).optional(),
}).strict();
export const mediaFolderCreateSchema = z.object({ name: z.string().trim().min(1).max(80) }).strict();
export const mediaFolderUpdateSchema = mediaFolderCreateSchema.extend({ id: z.uuid() });
export const mediaFolderDeleteSchema = z.object({ id: z.uuid() }).strict();
export const mediaMutationSchema = z.object({
  altText: z.string().trim().max(300),
  folderId: z.uuid().nullable(),
}).strict();

export type ReserveUploadInput = z.infer<typeof reserveUploadSchema>;
export type MediaListInput = z.infer<typeof mediaListInputSchema>;
export type MediaMutation = z.infer<typeof mediaMutationSchema>;

export interface UploadReservationResponse {
  id: string;
  uploadUrl: string;
  expiresAt: string;
  headers: {
    /** A document's only: how the store will hand it out, signed into the upload. */
    'content-disposition'?: string;
    'content-type': SupportedMediaType;
    'x-amz-checksum-sha256': string;
  };
}

export interface ReadyMedia {
  id: string;
  folder_id: string | null;
  original_name: string;
  mime_type: SupportedMediaType;
  size_bytes: number;
  /** Null for a document: only an image has dimensions. */
  width: number | null;
  height: number | null;
  alt_text: string | null;
  created_at: string;
  updated_at: string;
  publicUrl: string;
}

/** An image in the library: what a cover, the author's photo and an article's pictures are. */
export interface ReadyImage extends ReadyMedia {
  mime_type: SupportedImageType;
  width: number;
  height: number;
}

export interface MediaFolder {
  id: string;
  owner_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface MediaPage {
  hasMore: boolean;
  items: ReadyMedia[];
}

class InvalidUploadError extends Error {
  constructor(message: string, readonly objectKey: string, readonly status: 400 | 409 = 400, readonly code?: DocumentRefusal) {
    super(message);
  }
}

/** What a person is told when a document is not what it claims. The admin says it in the owner's language. */
const REFUSALS: Record<DocumentRefusal, string> = {
  media_macros: 'The file carries macros, which the library does not keep. Save it without them and upload it again.',
  media_text_encoding: 'Save the file as UTF-8 (in Excel, "CSV UTF-8") and upload it again.',
  media_type_mismatch: 'The file is not what its name says it is.',
};

function readyMedia(row: Selectable<MediaItemTable>): ReadyMedia {
  const size = Number(row.size_bytes);
  const limit = isImageType(row.mime_type) ? MAX_IMAGE_BYTES : MAX_DOCUMENT_FILE_BYTES;
  if (!Number.isSafeInteger(size) || size < 1 || size > limit) throw new Error('Stored media size is invalid.');
  return {
    id: row.id,
    folder_id: row.folder_id,
    original_name: row.original_name,
    mime_type: row.mime_type,
    size_bytes: size,
    width: row.width,
    height: row.height,
    alt_text: row.alt_text,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    publicUrl: stableMediaPath(row.id),
  };
}

function isReadyImage(media: ReadyMedia): media is ReadyImage {
  return isImageType(media.mime_type) && media.width !== null && media.height !== null;
}

function mediaFolder(row: Selectable<MediaFolderTable>): MediaFolder {
  return {
    id: row.id,
    owner_id: row.owner_id,
    name: row.name,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
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

async function assertOwnedFolder(ownerId: string, folderId: string | null): Promise<void> {
  if (!folderId) return;
  const folder = await db.selectFrom('media_folders').select('id')
    .where('id', '=', folderId).where('owner_id', '=', ownerId).executeTakeFirst();
  if (!folder) throw new HttpError(400, 'Choose a folder from this site.');
}

/**
 * A document's Content-Disposition, or null for an image. A document's name has to end in its
 * type's extension, so the name a reader downloads is the name of what the bytes were checked
 * to be; and it may be 25 MB, where an image may be 8.
 */
function uploadDisposition(input: ReserveUploadInput): string | null {
  if (isImageType(input.mimeType)) {
    if (input.sizeBytes > MAX_IMAGE_BYTES) throw new HttpError(400, 'Images must be 8 MB or smaller.');
    return null;
  }
  if (documentTypeForName(input.originalName) !== input.mimeType) {
    throw new HttpError(400, `A ${documentLabel(input.mimeType)} file's name ends in .${documentExtension(input.mimeType)}.`);
  }
  return contentDisposition(input.originalName, input.mimeType);
}

export async function reserveUpload(ownerId: string, input: ReserveUploadInput): Promise<UploadReservationResponse> {
  const disposition = uploadDisposition(input);
  await assertOwnedFolder(ownerId, input.folderId);
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
    alt_text: disposition ? null : input.altText || null,
    state: 'pending',
    expires_at: expiresAt,
    finalized_at: null,
  }).returning('id').executeTakeFirstOrThrow();
  const command = new PutObjectCommand({
    Bucket: s3Bucket,
    Key: objectKey,
    ContentType: input.mimeType,
    ChecksumSHA256: input.checksumSha256,
    ...(disposition ? { ContentDisposition: disposition } : {}),
  });
  try {
    const uploadUrl = await getSignedUrl(s3, command, {
      expiresIn: 300,
      // Signed, so the store refuses an upload that would change how the file is handed out.
      signableHeaders: new Set(disposition ? ['content-type', 'content-disposition'] : ['content-type']),
      unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
    });
    return {
      id: reservation.id,
      uploadUrl,
      expiresAt: expiresAt.toISOString(),
      headers: {
        ...(disposition ? { 'content-disposition': disposition } : {}),
        'content-type': input.mimeType,
        'x-amz-checksum-sha256': input.checksumSha256,
      },
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
      const expectedDisposition = isDocumentType(reservation.mime_type)
        ? contentDisposition(reservation.original_name, reservation.mime_type)
        : undefined;
      if (head.ContentLength !== expectedSize || head.ContentType !== reservation.mime_type
        || (head.ChecksumSHA256 && head.ChecksumSHA256 !== reservation.expected_checksum_sha256)
        || head.ContentDisposition !== expectedDisposition) {
        throw new InvalidUploadError('The uploaded object does not match its reservation.', reservation.object_key);
      }

      const dimensions = isImageType(reservation.mime_type)
        ? await verifiedImage(reservation.object_key, reservation.mime_type, expectedSize, reservation.expected_checksum_sha256)
        : await verifiedDocument(reservation.object_key, reservation.mime_type, expectedSize, reservation.expected_checksum_sha256);
      const item = await trx.insertInto('media_items').values({
        id: reservation.id,
        owner_id: ownerId,
        folder_id: reservation.folder_id,
        object_key: reservation.object_key,
        original_name: reservation.original_name,
        mime_type: reservation.mime_type,
        size_bytes: expectedSize,
        checksum_sha256: reservation.expected_checksum_sha256,
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
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
      throw new HttpError(error.status, error.message, error.code ? { code: error.code } : undefined);
    }
    throw error;
  }
}

/** An image, read whole: sharp needs all of it, and it is 8 MB at most. */
async function verifiedImage(objectKey: string, type: SupportedImageType, size: number, checksum: string): Promise<{ height: number; width: number }> {
  let body: Buffer;
  try {
    const object = await s3.send(new GetObjectCommand({ Bucket: s3Bucket, Key: objectKey, ChecksumMode: 'ENABLED' }));
    body = await readObjectBody(object.Body, size, objectKey);
  } catch (error) {
    if (error instanceof InvalidUploadError) throw error;
    throw new HttpError(503, 'Storage verification is temporarily unavailable. Try finalizing again.');
  }
  if (body.length !== size || createHash('sha256').update(body).digest('base64') !== checksum) {
    throw new InvalidUploadError('The uploaded object checksum or size is invalid.', objectKey);
  }
  try {
    return await inspectImage(body, type);
  } catch {
    throw new InvalidUploadError('The uploaded object is not a valid supported image.', objectKey);
  }
}

/** A document, read once as it streams and again only at a ZIP's end: never held whole. */
async function verifiedDocument(objectKey: string, type: SupportedDocumentType, size: number, checksum: string): Promise<null> {
  let refusal: DocumentRefusal | null;
  try {
    const object = await s3.send(new GetObjectCommand({ Bucket: s3Bucket, Key: objectKey, ChecksumMode: 'ENABLED' }));
    if (!object.Body || !(Symbol.asyncIterator in object.Body)) throw new Error('Object body is unavailable.');
    const read = await readDocument(object.Body as AsyncIterable<Uint8Array>, size, isTextDocument(type));
    if (!read) throw new InvalidUploadError('The uploaded object is larger than declared.', objectKey);
    if (read.size !== size || read.checksum !== checksum) {
      throw new InvalidUploadError('The uploaded object checksum or size is invalid.', objectKey);
    }
    refusal = await documentRefusal(type, read, (start, end) => readRange(objectKey, start, end));
  } catch (error) {
    if (error instanceof InvalidUploadError) throw error;
    throw new HttpError(503, 'Storage verification is temporarily unavailable. Try finalizing again.');
  }
  if (refusal) throw new InvalidUploadError(REFUSALS[refusal], objectKey, 400, refusal);
  return null;
}

async function readRange(objectKey: string, start: number, end: number): Promise<Buffer> {
  const object = await s3.send(new GetObjectCommand({ Bucket: s3Bucket, Key: objectKey, Range: `bytes=${start}-${end}` }));
  return readObjectBody(object.Body, end - start + 1, objectKey);
}

const MEDIA_PAGE_SIZE = 48;

/**
 * Every id is a ready item of this site, of the kind asked for. Images by default: a cover, the
 * author's photo and an article's pictures are images, and a crafted request must not make a
 * PDF one of them.
 */
export async function assertReadyMediaReferences(
  database: Kysely<Database>,
  ownerId: string,
  ids: string[],
  kind: MediaKind = 'image',
): Promise<void> {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const rows = await database.selectFrom('media_items').select('id')
    .where('owner_id', '=', ownerId).where('state', '=', 'ready').where('id', 'in', unique)
    .where('mime_type', 'in', kind === 'image' ? [...ACCEPTED_IMAGE_TYPES] : [...ACCEPTED_DOCUMENT_TYPES])
    .forShare().execute();
  if (rows.length !== unique.length) throw new HttpError(400, kind === 'image' ? 'Choose media from this site.' : 'Choose a file from this site.');
}

export async function listMedia(ownerId: string, input: MediaListInput): Promise<MediaPage> {
  let query = db.selectFrom('media_items').selectAll()
    .where('owner_id', '=', ownerId).where('state', '=', 'ready');
  if (input.folderId === null) query = query.where('folder_id', 'is', null);
  else if (input.folderId) query = query.where('folder_id', '=', input.folderId);
  if (input.type) query = query.where('mime_type', 'in', [...typesForFilter(input.type)]);
  const words = input.search.replace(/[^\p{L}\p{N}\s-]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length) {
    const pattern = `%${words.join('%')}%`;
    query = query.where((expression) => expression.or([
      expression('original_name', 'ilike', pattern),
      expression('alt_text', 'ilike', pattern),
    ]));
  }
  const rows = await query.orderBy('created_at', 'desc').orderBy('id', 'desc')
    .limit(MEDIA_PAGE_SIZE + 1).offset((input.page - 1) * MEDIA_PAGE_SIZE).execute();
  return { hasMore: rows.length > MEDIA_PAGE_SIZE, items: rows.slice(0, MEDIA_PAGE_SIZE).map(readyMedia) };
}

export async function listReadyMediaByIds(ownerId: string, requestedIds: readonly string[]): Promise<ReadyMedia[]> {
  const ids = [...new Set(requestedIds)];
  if (!ids.length) return [];
  return (await db.selectFrom('media_items').selectAll()
    .where('owner_id', '=', ownerId).where('state', '=', 'ready').where('id', 'in', ids)
    .orderBy('id').execute()).map(readyMedia);
}

/** Images only: covers, the author's photo and an article's pictures, which carry dimensions. */
export async function listReadyImagesByIds(ownerId: string, requestedIds: readonly string[]): Promise<ReadyImage[]> {
  return (await listReadyMediaByIds(ownerId, requestedIds)).filter(isReadyImage);
}

export async function listFolders(ownerId: string): Promise<MediaFolder[]> {
  return (await db.selectFrom('media_folders').selectAll().where('owner_id', '=', ownerId)
    .orderBy(sql`lower(name)`).orderBy('id').execute()).map(mediaFolder);
}

export async function createFolder(ownerId: string, name: string): Promise<MediaFolder> {
  return mediaFolder(await db.insertInto('media_folders').values({ owner_id: ownerId, name })
    .returningAll().executeTakeFirstOrThrow());
}

export async function renameFolder(ownerId: string, id: string, name: string): Promise<MediaFolder> {
  const row = await db.updateTable('media_folders').set({ name })
    .where('id', '=', id).where('owner_id', '=', ownerId).returningAll().executeTakeFirst();
  if (!row) throw new HttpError(404, 'Folder not found.');
  return mediaFolder(row);
}

export async function deleteFolder(ownerId: string, id: string): Promise<void> {
  const row = await db.deleteFrom('media_folders').where('id', '=', id).where('owner_id', '=', ownerId)
    .returning('id').executeTakeFirst();
  if (!row) throw new HttpError(404, 'Folder not found.');
}

export async function updateMedia(ownerId: string, id: string, input: MediaMutation): Promise<ReadyMedia> {
  await assertOwnedFolder(ownerId, input.folderId);
  const row = await db.updateTable('media_items').set({
    alt_text: input.altText || null,
    folder_id: input.folderId,
  }).where('id', '=', id).where('owner_id', '=', ownerId).where('state', '=', 'ready')
    .returningAll().executeTakeFirst();
  if (!row) throw new HttpError(404, 'Media not found.');
  return readyMedia(row);
}

interface MediaReferences {
  counts: { pageContent: number; postContent: number; postCovers: number; profile: number };
  pages: Array<{ id: string; title: string }>;
  posts: Array<{ id: string; title: string }>;
  profile: boolean;
}

function contentReferencesMedia(id: string) {
  return sql<boolean>`jsonb_path_exists(
    content_json,
    '$.**.attrs.mediaId ? (@ == $mediaId)',
    jsonb_build_object('mediaId', to_jsonb(${id}::text))
  )`;
}

async function findMediaReferences(
  trx: Transaction<Database>,
  ownerId: string,
  id: string,
): Promise<MediaReferences> {
  const [coverPosts, contentPosts, pages, profile] = await Promise.all([
    trx.selectFrom('posts').select(['id', 'title']).where('owner_id', '=', ownerId).where('cover_media_id', '=', id).execute(),
    trx.selectFrom('posts').select(['id', 'title']).where('owner_id', '=', ownerId).where(contentReferencesMedia(id)).execute(),
    trx.selectFrom('pages').select(['id', 'title']).where('owner_id', '=', ownerId).where(contentReferencesMedia(id)).execute(),
    trx.selectFrom('site_settings').select('id').where('owner_id', '=', ownerId).where('author_avatar_media_id', '=', id).executeTakeFirst(),
  ]);
  const posts = [...new Map([...coverPosts, ...contentPosts].map((post) => [post.id, post])).values()];
  return {
    counts: { pageContent: pages.length, postContent: contentPosts.length, postCovers: coverPosts.length, profile: profile ? 1 : 0 },
    pages,
    posts,
    profile: Boolean(profile),
  };
}

function referenceCount(references: MediaReferences): number {
  return Object.values(references.counts).reduce((total, count) => total + count, 0);
}

function storageErrorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('name' in error) || typeof error.name !== 'string') return 'StorageError';
  return /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(error.name) ? error.name : 'StorageError';
}

export async function deleteMedia(ownerId: string, id: string): Promise<void> {
  const objectKey = await db.transaction().execute(async (trx) => {
    const item = await trx.selectFrom('media_items').selectAll()
      .where('id', '=', id).where('owner_id', '=', ownerId).forUpdate().executeTakeFirst();
    if (!item) throw new HttpError(404, 'Media not found.');
    const references = await findMediaReferences(trx, ownerId, id);
    const count = referenceCount(references);
    if (count) {
      throw new HttpError(409, `This file is still used in ${count} location${count === 1 ? '' : 's'}.`, { references });
    }
    if (item.state !== 'deleting') {
      await trx.updateTable('media_items').set({ state: 'deleting', delete_error_code: null })
        .where('id', '=', id).where('owner_id', '=', ownerId).executeTakeFirstOrThrow();
    }
    return item.object_key;
  });

  try {
    await s3.send(new DeleteObjectCommand({ Bucket: s3Bucket, Key: objectKey }));
  } catch (error) {
    if (!isNotFound(error)) {
      await db.updateTable('media_items').set({ state: 'delete_failed', delete_error_code: storageErrorCode(error) })
        .where('id', '=', id).where('owner_id', '=', ownerId).where('state', '=', 'deleting').execute();
      throw new HttpError(503, 'Storage is temporarily unavailable. Try deleting the file again.');
    }
  }
  await db.deleteFrom('media_items').where('id', '=', id).where('owner_id', '=', ownerId).where('state', '=', 'deleting').execute();
}
