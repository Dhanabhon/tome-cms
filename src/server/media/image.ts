import sharp from 'sharp';

import type { SupportedImageType } from '../../lib/media';

const MAX_PIXELS = 40_000_000;

/** The raster type the bytes themselves say, whatever the file was called. */
export function detectImageType(buffer: Buffer): SupportedImageType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brands = buffer.subarray(8, Math.min(buffer.length, 64)).toString('ascii');
    if (brands.includes('avif') || brands.includes('avis')) return 'image/avif';
  }
  return null;
}

export async function inspectImage(
  buffer: Buffer,
  expectedType: SupportedImageType,
): Promise<{ height: number; width: number }> {
  if (detectImageType(buffer) !== expectedType) throw new Error('The uploaded bytes do not match the selected image type.');
  const metadata = await sharp(buffer, { animated: true, failOn: 'error', limitInputPixels: MAX_PIXELS }).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.pageHeight ?? metadata.height ?? 0;
  if (!width || !height || width * height > MAX_PIXELS) throw new Error('The uploaded image dimensions are invalid.');
  return { height, width };
}

/** The widths a picture is also kept at, for a page to draw the copy that fits. */
export const VARIANT_WIDTHS = [480, 960, 1600] as const;
export type VariantWidth = (typeof VARIANT_WIDTHS)[number];

/**
 * The smaller copies of a picture: WebP, turned the way it was taken, with its metadata left
 * out, at each width narrower than the picture itself. None for an animated one. Made one after
 * another, so only one decode is held at a time.
 */
export async function makeVariants(buffer: Buffer): Promise<{ body: Buffer; width: VariantWidth }[]> {
  const options = { failOn: 'error', limitInputPixels: MAX_PIXELS } as const;
  const metadata = await sharp(buffer, options).metadata();
  if ((metadata.pages ?? 1) > 1) return [];
  const variants = [];
  for (const width of VARIANT_WIDTHS.filter((candidate) => candidate < metadata.autoOrient.width)) {
    variants.push({ body: await sharp(buffer, options).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer(), width });
  }
  return variants;
}
