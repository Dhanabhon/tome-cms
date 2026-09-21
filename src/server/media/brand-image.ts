import sharp from 'sharp';

import { HttpError } from '../http/errors';
import { detectImageType } from './image';
import { sanitizeSvg } from './svg';

export type BrandKind = 'logo' | 'logo-dark' | 'icon';
export const BRAND_KINDS: readonly BrandKind[] = ['logo', 'logo-dark', 'icon'];

/** The most a logo or an icon may weigh, before anything is done with it. */
export const MAX_BRAND_BYTES = 1024 * 1024;
/** A phone's home screen draws an icon at 180 pixels; a raster one smaller would be blown up. */
export const MIN_ICON_PIXELS = 180;
const MAX_PIXELS = 40_000_000;
const ICON_SIZES = [32, 180] as const;

export type BrandMime = 'image/jpeg' | 'image/png' | 'image/svg+xml' | 'image/webp';
const EXTENSION = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/svg+xml': 'svg', 'image/webp': 'webp' } as const;
const ACCEPTED: Record<BrandKind, readonly BrandMime[]> = {
  icon: ['image/png', 'image/svg+xml'],
  logo: ['image/jpeg', 'image/png', 'image/svg+xml', 'image/webp'],
  'logo-dark': ['image/jpeg', 'image/png', 'image/svg+xml', 'image/webp'],
};

export interface PreparedFile { body: Buffer; contentType: BrandMime; extension: 'jpg' | 'png' | 'svg' | 'webp' }
export type PreparedBrand =
  | { kind: 'logo' | 'logo-dark'; source: PreparedFile; mime: BrandMime; width: number; height: number }
  | { kind: 'icon'; svg: PreparedFile | null; png32: PreparedFile; png180: PreparedFile };

const refuse = (status: 400 | 413 | 415, message: string, code: string) => new HttpError(status, message, { code });
const unusableSvg = () => refuse(400, 'This SVG could not be drawn once made safe.', 'brand_svg_unusable');
const unreadable = () => refuse(415, 'This kind of file is not accepted here.', 'brand_type');

/** An SVG says so in its first tag; nothing else accepted here is text. */
function looksLikeSvg(bytes: Buffer): boolean {
  const head = bytes.subarray(0, 1024).toString('utf8').replace(/^﻿/, '').trimStart();
  return /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head);
}

function file(body: Buffer, contentType: BrandMime): PreparedFile {
  return { body, contentType, extension: EXTENSION[contentType] };
}

async function sizeOf(body: Buffer): Promise<{ height: number; width: number }> {
  const metadata = await sharp(body, { failOn: 'error', limitInputPixels: MAX_PIXELS }).metadata();
  return { height: metadata.height ?? 0, width: metadata.width ?? 0 };
}

/** Drawn on a transparent square, so an icon that is not square is centred rather than stretched. */
function rendition(source: Buffer, size: number, density: number): Promise<Buffer> {
  return sharp(source, { density, failOn: 'error', limitInputPixels: MAX_PIXELS })
    .resize(size, size, { background: { alpha: 0, b: 0, g: 0, r: 0 }, fit: 'contain' })
    .png()
    .toBuffer();
}

async function svgSource(kind: BrandKind, bytes: Buffer): Promise<{ size: { height: number; width: number }; source: PreparedFile }> {
  if (!ACCEPTED[kind].includes('image/svg+xml')) throw unreadable();
  const clean = sanitizeSvg(bytes.toString('utf8'));
  if (!/^<svg[\s>]/.test(clean)) throw unusableSvg();
  const source = file(Buffer.from(clean, 'utf8'), 'image/svg+xml');
  const size = await sizeOf(source.body).catch(() => { throw unusableSvg(); });
  if (!size.width || !size.height) throw unusableSvg();
  return { size, source };
}

async function rasterSource(kind: BrandKind, bytes: Buffer): Promise<{ size: { height: number; width: number }; source: PreparedFile }> {
  const detected = detectImageType(bytes);
  if (!detected || !(ACCEPTED[kind] as readonly string[]).includes(detected)) throw unreadable();
  const size = await sizeOf(bytes).catch(() => { throw unreadable(); });
  if (!size.width || !size.height) throw unreadable();
  return { size, source: file(bytes, detected as BrandMime) };
}

/**
 * A logo or an icon as it may be stored: the type read from the bytes, an SVG made safe and
 * still drawable, a raster logo as it came, an icon drawn at a tab's size and a phone's.
 */
export async function prepareBrandImage(kind: BrandKind, bytes: Buffer): Promise<PreparedBrand> {
  if (bytes.byteLength > MAX_BRAND_BYTES) throw refuse(413, 'The file is larger than 1 MB.', 'brand_too_large');
  const { size, source } = looksLikeSvg(bytes) ? await svgSource(kind, bytes) : await rasterSource(kind, bytes);

  if (kind !== 'icon') return { height: size.height, kind, mime: source.contentType, source, width: size.width };

  const isSvg = source.contentType === 'image/svg+xml';
  if (!isSvg && Math.min(size.width, size.height) < MIN_ICON_PIXELS) {
    throw refuse(400, 'An icon must be at least 180 by 180 pixels.', 'brand_icon_small');
  }
  // An SVG is drawn at the density that gives it a 512-pixel short side, so the 180-pixel icon
  // comes from detail rather than from a 24-pixel viewBox blown up.
  const density = isSvg ? Math.min(2400, Math.max(72, Math.ceil(72 * 512 / Math.min(size.width, size.height)))) : 72;
  const [png32, png180] = await Promise.all(ICON_SIZES.map(async (edge) => file(await rendition(source.body, edge, density), 'image/png')));
  return { kind, png180: png180!, png32: png32!, svg: isSvg ? source : null };
}
