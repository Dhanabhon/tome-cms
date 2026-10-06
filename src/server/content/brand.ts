import { CopyObjectCommand, DeleteObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

import { editableBrand, siteBrand, storedBrandKeys, type SiteBrand, type StoredBrandIcon, type StoredBrandImage } from '../../lib/site-brand';
import { prepareBrandImage, type BrandKind, type PreparedFile } from '../media/brand-image';
import { dispositionForType } from '../media/disposition';
import { createBrandObjectKey } from '../media/keys';
import { s3, s3Bucket } from '../media/storage';
import { resolveMediaUrl } from '../media/url';
import { getSiteSettings, writeSiteBrand, type BrandColumn, type SiteSettings } from './settings';

const COLUMN: Record<BrandKind, BrandColumn> = { icon: 'brand_icon', logo: 'brand_logo', 'logo-dark': 'brand_logo_dark', share: 'brand_share' };
/** A key is never reused, so what is behind one never changes. */
const IMMUTABLE = 'public, max-age=31536000, immutable';

/** What the Settings form is given back: everything stored, and the row's new version. */
export interface BrandResult { brand: SiteBrand; updatedAt: string }

/** What a page draws. */
export function brandOf(settings: SiteSettings): SiteBrand {
  return siteBrand(settings, resolveMediaUrl);
}

/** What the owner is shown, dark logo included whether or not it is drawn. */
export function editableBrandOf(settings: SiteSettings): SiteBrand {
  return editableBrand(settings, resolveMediaUrl);
}

async function put(ownerId: string, file: PreparedFile, written: string[]): Promise<string> {
  const key = createBrandObjectKey(ownerId, file.extension);
  const disposition = dispositionForType(file.contentType);
  await s3.send(new PutObjectCommand({
    Body: file.body, Bucket: s3Bucket, CacheControl: IMMUTABLE, ContentType: file.contentType, Key: key,
    ...(disposition ? { ContentDisposition: disposition } : {}),
  }));
  written.push(key);
  return key;
}

/** Best effort: an object nothing points at is harmless; a setting that points at nothing is not. */
async function removeObjects(keys: string[]): Promise<void> {
  const results = await Promise.allSettled(keys.map((Key) => s3.send(new DeleteObjectCommand({ Bucket: s3Bucket, Key }))));
  if (results.some(({ status }) => status === 'rejected')) console.error('A brand object could not be deleted');
}

/**
 * A logo, a dark logo, an icon or a share image, in this order: checked, stored, recorded, and only then is
 * what it replaced deleted. A failure before the record deletes what this request stored.
 */
export async function storeBrandImage(ownerId: string, kind: BrandKind, bytes: Buffer): Promise<BrandResult> {
  const prepared = await prepareBrandImage(kind, bytes);
  const written: string[] = [];
  let recorded: Awaited<ReturnType<typeof writeSiteBrand>>;
  try {
    let value: StoredBrandIcon | StoredBrandImage;
    if (prepared.kind === 'icon') {
      value = {
        png180Key: await put(ownerId, prepared.png180, written),
        png32Key: await put(ownerId, prepared.png32, written),
        svgKey: prepared.svg ? await put(ownerId, prepared.svg, written) : null,
      };
    } else {
      value = { height: prepared.height, key: await put(ownerId, prepared.source, written), mime: prepared.mime, width: prepared.width };
    }
    recorded = await writeSiteBrand(ownerId, COLUMN[kind], value);
  } catch (error) {
    await removeObjects(written);
    throw error;
  }
  await removeObjects(storedBrandKeys(recorded.previous));
  return { brand: editableBrandOf(recorded.settings), updatedAt: recorded.settings.updated_at.toISOString() };
}

export async function removeBrandImage(ownerId: string, kind: BrandKind): Promise<BrandResult> {
  const { previous, settings } = await writeSiteBrand(ownerId, COLUMN[kind], null);
  await removeObjects(storedBrandKeys(previous));
  return { brand: editableBrandOf(settings), updatedAt: settings.updated_at.toISOString() };
}

/**
 * An SVG stored before 1.16.4 went up without the download header. This copies each one onto
 * itself with it, keeping its type and cache rule; one already carrying it is left alone, so
 * running it again costs a HEAD per SVG. Returns how many it changed.
 */
export async function backfillBrandSvgDownloads(): Promise<number> {
  const settings = await getSiteSettings();
  if (!settings) return 0;
  const keys = [settings.brand_logo, settings.brand_logo_dark, settings.brand_icon]
    .flatMap(storedBrandKeys)
    .filter((key) => key.endsWith('.svg'));
  let changed = 0;
  for (const key of keys) {
    const head = await s3.send(new HeadObjectCommand({ Bucket: s3Bucket, Key: key }));
    if (head.ContentDisposition === dispositionForType('image/svg+xml')) continue;
    await s3.send(new CopyObjectCommand({
      Bucket: s3Bucket, Key: key, CopySource: `${s3Bucket}/${key}`, MetadataDirective: 'REPLACE',
      CacheControl: IMMUTABLE, ContentType: 'image/svg+xml', ContentDisposition: dispositionForType('image/svg+xml'),
    }));
    changed += 1;
  }
  return changed;
}
