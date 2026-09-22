import type { AdminCopy } from './admin-i18n';
import { declaredMediaType, isImageType, MediaFileError, uploadTimeoutMs, type MediaKind, type MediaTypeFilter, type SupportedMediaType } from './media';
import type {
  MediaAsset,
  MediaFolder,
  MediaReferences,
  UploadImageOptions,
} from '../types/cms';

export const MEDIA_PAGE_SIZE = 48;

export interface ListMediaInput {
  folderId?: string | null;
  page?: number;
  search?: string;
  type?: MediaTypeFilter;
}

export interface MediaPage {
  hasMore: boolean;
  items: MediaAsset[];
}

export interface MediaDraft {
  altText: string;
  folderId: string;
}

interface UploadReservation {
  expiresAt: string;
  /** Every header the store signed; a document's include its Content-Disposition. */
  headers: Record<string, string>;
  id: string;
  uploadUrl: string;
}

export class MediaRequestError extends Error {
  constructor(message: string, readonly references?: MediaReferences, readonly code?: string) {
    super(message);
    this.name = 'MediaRequestError';
  }
}

/** Why an upload failed, in its owner's language, when its cause is one the admin can name. */
export function uploadFailureText(error: unknown, copy: AdminCopy): string | undefined {
  if (error instanceof MediaFileError) return copy.media.refusals[error.refusal];
  if (!(error instanceof MediaRequestError)) return undefined;
  switch (error.code) {
    case 'media_macros': return copy.media.refusals.macros;
    case 'media_text_encoding': return copy.media.refusals.textEncoding;
    case 'media_type_mismatch': return copy.media.refusals.typeMismatch;
    case 'storage_rejected': return copy.media.storageRejected;
    case 'storage_timeout': return copy.media.storageTimedOut;
    case 'storage_unreachable': return copy.media.storageUnreachable;
    default: return undefined;
  }
}

function errorMessage(payload: unknown): string | null {
  return typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string'
    ? payload.error : null;
}

function errorReferences(payload: unknown): MediaReferences | undefined {
  if (typeof payload !== 'object' || payload === null || !('references' in payload)
    || typeof payload.references !== 'object' || payload.references === null) return undefined;
  return payload.references as MediaReferences;
}

function errorCode(payload: unknown): string | undefined {
  return typeof payload === 'object' && payload !== null && 'code' in payload && typeof payload.code === 'string' ? payload.code : undefined;
}

async function readJson<T>(response: Response): Promise<T> {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new MediaRequestError(errorMessage(payload) ?? 'The request could not be completed.', errorReferences(payload), errorCode(payload));
  return payload as T;
}

async function sendJson<T>(path: string, method: 'POST' | 'PUT' | 'DELETE', body: unknown): Promise<T> {
  return readJson<T>(await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function sha256(file: File): Promise<string> {
  return bytesToBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())));
}

function uploadToStorage(
  reservation: UploadReservation,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', reservation.uploadUrl);
    request.timeout = uploadTimeoutMs(file.size);
    for (const [name, value] of Object.entries(reservation.headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => request.status >= 200 && request.status < 300
      ? resolve()
      : reject(new MediaRequestError('Storage rejected the upload. Try again.', undefined, 'storage_rejected'));
    request.onerror = () => reject(new MediaRequestError('The upload could not reach storage. Try again.', undefined, 'storage_unreachable'));
    request.ontimeout = () => reject(new MediaRequestError('The upload timed out. Try again.', undefined, 'storage_timeout'));
    request.send(file);
  });
}

export async function listMediaFolders(): Promise<MediaFolder[]> {
  return (await readJson<{ folders: MediaFolder[] }>(await fetch('/api/admin/media/folders'))).folders;
}

export async function createMediaFolder(name: string): Promise<MediaFolder> {
  return (await sendJson<{ folder: MediaFolder }>('/api/admin/media/folders', 'POST', { name })).folder;
}

export async function renameMediaFolder(id: string, name: string): Promise<MediaFolder> {
  return (await sendJson<{ folder: MediaFolder }>('/api/admin/media/folders', 'PUT', { id, name })).folder;
}

export async function deleteMediaFolder(id: string): Promise<void> {
  await sendJson('/api/admin/media/folders', 'DELETE', { id });
}

export async function saveMediaDraft(id: string, draft: MediaDraft): Promise<MediaAsset> {
  return (await sendJson<{ item: MediaAsset }>(`/api/admin/media/${id}`, 'PUT', {
    altText: draft.altText,
    folderId: draft.folderId || null,
  })).item;
}

export async function deleteMedia(id: string): Promise<void> {
  await readJson(await fetch(`/api/admin/media/${id}`, { method: 'DELETE' }));
}

export async function listMedia(input: ListMediaInput = {}): Promise<MediaPage> {
  const params = new URLSearchParams({ page: String(input.page ?? 1) });
  if (input.search) params.set('search', input.search);
  if (input.folderId === null) params.set('folderId', 'unfiled');
  else if (input.folderId) params.set('folderId', input.folderId);
  if (input.type) params.set('type', input.type);
  return readJson<MediaPage>(await fetch(`/api/admin/media?${params}`));
}

export interface UploadFileOptions extends UploadImageOptions {
  /** What the picker it is chosen in takes: images, documents, or -- the library page -- any. */
  accept?: MediaKind | 'any';
}

async function upload(file: File, mimeType: SupportedMediaType, options: UploadImageOptions): Promise<MediaAsset> {
  const checksumSha256 = await sha256(file);
  const reservation = (await sendJson<{ reservation: UploadReservation }>('/api/admin/media/uploads', 'POST', {
    originalName: file.name,
    mimeType,
    sizeBytes: file.size,
    checksumSha256,
    folderId: options.folderId ?? null,
    altText: isImageType(mimeType) ? options.altText ?? '' : '',
  })).reservation;
  await uploadToStorage(reservation, file, options.onProgress);
  options.onProgress?.(100);
  return (await sendJson<{ item: MediaAsset }>(`/api/admin/media/uploads/${reservation.id}/finalize`, 'POST', {})).item;
}

/** An image dropped or pasted into the editor. */
export async function uploadImage(file: File, options: UploadImageOptions = {}): Promise<MediaAsset> {
  return upload(file, declaredMediaType(file, 'image'), options);
}

/** Any file the library keeps, refused in the browser -- with a MediaFileError -- when it cannot be kept. */
export async function uploadFile(file: File, options: UploadFileOptions = {}): Promise<MediaAsset> {
  return upload(file, declaredMediaType(file, options.accept ?? 'any'), options);
}
