export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

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
