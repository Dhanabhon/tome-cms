import { z } from 'zod';

const brandMime = z.enum(['image/jpeg', 'image/png', 'image/svg+xml', 'image/webp']);
const objectKey = z.string().min(1).max(512);

export const storedBrandImageSchema = z.object({
  height: z.number().int().positive(),
  key: objectKey,
  mime: brandMime,
  width: z.number().int().positive(),
}).strict();

export const storedBrandIconSchema = z.object({
  png180Key: objectKey,
  png32Key: objectKey,
  svgKey: objectKey.nullable(),
}).strict();

export type BrandMime = z.infer<typeof brandMime>;
export type StoredBrandImage = z.infer<typeof storedBrandImageSchema>;
export type StoredBrandIcon = z.infer<typeof storedBrandIconSchema>;

/** What site_settings holds about the site's own logo, name and icon. */
export interface StoredBrand {
  brand_icon: StoredBrandIcon | null;
  brand_logo: StoredBrandImage | null;
  brand_logo_dark: StoredBrandImage | null;
  hide_site_name: boolean;
}

export interface BrandImage { height: number; mimeType: BrandMime; url: string; width: number }
export interface BrandIcon { png180: string; png32: string; svg: string | null }
export interface SiteBrand { icon: BrandIcon | null; logo: BrandImage | null; logoDark: BrandImage | null; showSiteName: boolean }
export interface IconLink { href: string; rel: 'apple-touch-icon' | 'icon'; sizes?: string; type?: string }

export const NO_BRAND: SiteBrand = { icon: null, logo: null, logoDark: null, showSiteName: true };

/** A brand column's value, or nothing: a value of any other shape reads as nothing stored. */
export function parseStoredImage(value: unknown): StoredBrandImage | null {
  const parsed = storedBrandImageSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseStoredIcon(value: unknown): StoredBrandIcon | null {
  const parsed = storedBrandIconSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * What a site wears, with each key made an address.
 *
 * The name leaves the header only while a logo stands in for it: take the logo away and the
 * name comes back, whatever the switch still says. A dark logo is the dark half of a logo, so
 * it is drawn only beside one.
 */
export function siteBrand(stored: StoredBrand, resolve: (key: string) => string): SiteBrand {
  const image = (value: StoredBrandImage | null): BrandImage | null => value
    ? { height: value.height, mimeType: value.mime, url: resolve(value.key), width: value.width }
    : null;
  const logo = image(stored.brand_logo);
  const icon = stored.brand_icon;
  return {
    icon: icon ? { png180: resolve(icon.png180Key), png32: resolve(icon.png32Key), svg: icon.svgKey ? resolve(icon.svgKey) : null } : null,
    logo,
    logoDark: logo ? image(stored.brand_logo_dark) : null,
    showSiteName: !logo || !stored.hide_site_name,
  };
}

/** Every object a stored value names -- what a replacement deletes and a reset accounts for. */
export function storedBrandKeys(value: unknown): string[] {
  const image = parseStoredImage(value);
  if (image) return [image.key];
  const icon = parseStoredIcon(value);
  return icon ? [icon.svgKey, icon.png32Key, icon.png180Key].filter((key): key is string => key !== null) : [];
}

/**
 * The icon links a public page carries. A PNG first, for every browser; the SVG after it, for
 * those that prefer one; a phone's home screen takes only the PNG. Without an icon of its own
 * the site wears TomeCMS's.
 */
export function iconLinks(icon: BrandIcon | null): IconLink[] {
  if (!icon) return [{ href: '/favicon.svg', rel: 'icon', type: 'image/svg+xml' }];
  return [
    { href: icon.png32, rel: 'icon', sizes: '32x32', type: 'image/png' },
    ...(icon.svg ? [{ href: icon.svg, rel: 'icon' as const, type: 'image/svg+xml' }] : []),
    { href: icon.png180, rel: 'apple-touch-icon' },
  ];
}
