export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export const ACCEPTED_IMAGE_TYPES = [
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

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

export function imageExtension(type: string): string | null {
  return type in IMAGE_EXTENSIONS ? IMAGE_EXTENSIONS[type as SupportedImageType] : null;
}

export function validateImageFile(file: File): void {
  if (!file.size) throw new Error('Images must be at least 1 byte.');
  if (!imageExtension(file.type)) throw new Error('Use a JPEG, PNG, WebP, GIF, or AVIF image.');
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Images must be 8 MB or smaller.');
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
