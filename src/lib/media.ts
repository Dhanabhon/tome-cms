import type { MediaAsset } from '../types/cms';

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * A document is checked as it streams past rather than held whole, as an image has to be for
 * sharp, so it may be larger than one.
 */
export const MAX_DOCUMENT_FILE_BYTES = 25 * 1024 * 1024;

export const ACCEPTED_IMAGE_TYPES = [
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

/**
 * What the library keeps beside its images. Office in its current formats only: a legacy
 * binary file can carry a macro that no look at its signature finds, and a macro-enabled one
 * is named for carrying them.
 */
export const ACCEPTED_DOCUMENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv',
  'text/plain',
  'application/zip',
] as const;

export const ACCEPTED_MEDIA_TYPES = [...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_DOCUMENT_TYPES] as const;

/** Two minutes, or 50 KB a second when that is longer -- enough for a 25 MB document on a slow link. */
export function uploadTimeoutMs(sizeBytes: number): number {
  return Math.max(120_000, Math.ceil(sizeBytes / 50));
}

export const COVER_IMAGE_GUIDANCE = {
  hardLimitBytes: MAX_IMAGE_BYTES,
  recommendedHeight: 900,
  recommendedMaxBytes: 2 * 1024 * 1024,
  recommendedMinHeight: 675,
  recommendedMinWidth: 1200,
  recommendedWidth: 1600,
} as const;

const IMAGE_EXTENSIONS = {
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

export type SupportedImageType = keyof typeof IMAGE_EXTENSIONS;
export type SupportedDocumentType = (typeof ACCEPTED_DOCUMENT_TYPES)[number];
export type SupportedMediaType = SupportedImageType | SupportedDocumentType;
export type MediaKind = 'image' | 'document';

/** The groups the library filters documents by, beside images. */
export const DOCUMENT_GROUPS = ['pdf', 'document', 'spreadsheet', 'slides', 'zip'] as const;
export type DocumentGroup = (typeof DOCUMENT_GROUPS)[number];
/** What `GET /api/admin/media?type=` takes. `file` is every document. */
export const MEDIA_TYPE_FILTERS = ['image', 'file', ...DOCUMENT_GROUPS] as const;
export type MediaTypeFilter = (typeof MEDIA_TYPE_FILTERS)[number];

/** Each document's extension, its group, and the abbreviation a reader sees in every language. */
const DOCUMENT_FORMATS: Record<SupportedDocumentType, { extension: string; group: DocumentGroup; label: string }> = {
  'application/pdf': { extension: 'pdf', group: 'pdf', label: 'PDF' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { extension: 'docx', group: 'document', label: 'DOCX' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { extension: 'xlsx', group: 'spreadsheet', label: 'XLSX' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { extension: 'pptx', group: 'slides', label: 'PPTX' },
  'text/csv': { extension: 'csv', group: 'spreadsheet', label: 'CSV' },
  'text/plain': { extension: 'txt', group: 'document', label: 'TXT' },
  'application/zip': { extension: 'zip', group: 'zip', label: 'ZIP' },
};

export function isImageType(type: string): type is SupportedImageType {
  return Object.hasOwn(IMAGE_EXTENSIONS, type);
}

export function isDocumentType(type: string): type is SupportedDocumentType {
  return Object.hasOwn(DOCUMENT_FORMATS, type);
}

export function imageExtension(type: string): string | null {
  return isImageType(type) ? IMAGE_EXTENSIONS[type] : null;
}

export function documentExtension(type: SupportedDocumentType): string {
  return DOCUMENT_FORMATS[type].extension;
}

/** 'PDF', 'DOCX': what a card and a tile call a document, the same in every language. */
export function documentLabel(type: SupportedDocumentType): string {
  return DOCUMENT_FORMATS[type].label;
}

/** What a tile calls a file's format: PNG and WEBP for images, PDF and DOCX for documents. */
export function formatLabel(type: SupportedMediaType): string {
  return isDocumentType(type) ? documentLabel(type) : type.replace('image/', '').toUpperCase();
}

export function mediaExtension(type: string): string | null {
  if (isImageType(type)) return IMAGE_EXTENSIONS[type];
  return isDocumentType(type) ? DOCUMENT_FORMATS[type].extension : null;
}

/** The document a name says a file is, by its extension alone. */
export function documentTypeForName(name: string): SupportedDocumentType | null {
  const extension = /\.([a-z0-9]+)$/i.exec(name.trim())?.[1]?.toLowerCase();
  return ACCEPTED_DOCUMENT_TYPES.find((type) => DOCUMENT_FORMATS[type].extension === extension) ?? null;
}

/** The types a filter admits, for the library's query. */
export function typesForFilter(filter: MediaTypeFilter): readonly SupportedMediaType[] {
  if (filter === 'image') return ACCEPTED_IMAGE_TYPES;
  if (filter === 'file') return ACCEPTED_DOCUMENT_TYPES;
  return ACCEPTED_DOCUMENT_TYPES.filter((type) => DOCUMENT_FORMATS[type].group === filter);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(kilobytes < 10 ? 1 : 0)} KB`;
  const megabytes = kilobytes / 1024;
  return `${megabytes.toFixed(megabytes < 10 ? 1 : 0)} MB`;
}

/** Why the browser will not send a file, as a key of the admin's copy. */
export type MediaRefusal = 'documentTooLarge' | 'empty' | 'imageTooLarge' | 'unsupported' | 'unsupportedDocument' | 'unsupportedImage';

export class MediaFileError extends Error {
  constructor(readonly refusal: MediaRefusal) {
    super(refusal);
    this.name = 'MediaFileError';
  }
}

/**
 * The type a chosen file is sent as. An image is what the browser says, having read it. A
 * document is what its name says, because browsers disagree on a CSV's type or a ZIP's and some
 * report none. The server reads the bytes either way.
 */
export function declaredMediaType(
  file: { name: string; size: number; type: string },
  accept: MediaKind | 'any' = 'any',
): SupportedMediaType {
  if (!file.size) throw new MediaFileError('empty');
  if (accept !== 'document' && isImageType(file.type)) {
    if (file.size > MAX_IMAGE_BYTES) throw new MediaFileError('imageTooLarge');
    return file.type;
  }
  const documentType = accept === 'image' ? null : documentTypeForName(file.name);
  if (documentType) {
    if (file.size > MAX_DOCUMENT_FILE_BYTES) throw new MediaFileError('documentTooLarge');
    return documentType;
  }
  throw new MediaFileError(accept === 'image' ? 'unsupportedImage' : accept === 'document' ? 'unsupportedDocument' : 'unsupported');
}

/** A file input's `accept`: types for images, types and extensions for documents. */
export function acceptAttribute(accept: MediaKind | 'any'): string {
  const images = accept === 'document' ? [] : [...ACCEPTED_IMAGE_TYPES];
  const documents = accept === 'image' ? [] : ACCEPTED_DOCUMENT_TYPES.flatMap((type) => [type, `.${DOCUMENT_FORMATS[type].extension}`]);
  return [...images, ...documents].join(',');
}

export async function imageDimensions(file: File): Promise<{ height: number; width: number }> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('The image has no readable dimensions.');
    return { height: image.naturalHeight, width: image.naturalWidth };
  } catch {
    throw new Error('This image cannot be decoded. Choose a valid image file.');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** A library item that is an image, with the dimensions every image has. */
export function isImageAsset(asset: MediaAsset): asset is MediaAsset & { height: number; mime_type: SupportedImageType; width: number } {
  return isImageType(asset.mime_type) && asset.width !== null && asset.height !== null;
}
