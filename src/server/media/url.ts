import { getServerEnv } from '../env';
import { isUuid } from './keys';

function objectKeySegments(objectKey: string): string[] {
  if (objectKey.includes('\\') || /[\u0000-\u001f\u007f]/.test(objectKey)) throw new Error('Media object key is invalid.');
  const segments = objectKey.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) throw new Error('Media object key is invalid.');
  return segments;
}

export function resolveMediaUrl(objectKey: string): string {
  const base = new URL(getServerEnv().MEDIA_PUBLIC_URL);
  if (base.search || base.hash) throw new Error('MEDIA_PUBLIC_URL must not include a query or fragment.');
  base.pathname = `${base.pathname.replace(/\/*$/, '/')}${objectKeySegments(objectKey).map(encodeURIComponent).join('/')}`;
  return base.toString();
}

export function stableMediaPath(mediaId: string): string {
  if (!isUuid(mediaId)) throw new Error('Media ID must be a UUID.');
  return `/media/${mediaId.toLowerCase()}`;
}
