import { randomUUID } from 'node:crypto';

import { imageExtension, type SupportedImageType } from '../../lib/media';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OBJECT_KEY = /^owners\/([0-9a-f-]{36})\/(\d{4})\/(0[1-9]|1[0-2])\/([0-9a-f-]{36})\.(avif|gif|jpg|png|svg|webp)$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export function isTomeObjectKey(value: string): boolean {
  const match = OBJECT_KEY.exec(value);
  return Boolean(match && isUuid(match[1] ?? '') && isUuid(match[4] ?? ''));
}

function objectKey(ownerId: string, extension: string, now: Date): string {
  if (!isUuid(ownerId)) throw new Error('Media owner ID must be a UUID.');
  if (Number.isNaN(now.getTime())) throw new Error('Media date is invalid.');
  return `owners/${ownerId.toLowerCase()}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${extension}`;
}

export function createObjectKey(ownerId: string, mimeType: SupportedImageType, now = new Date()): string {
  if (!isUuid(ownerId)) throw new Error('Media owner ID must be a UUID.');
  const extension = imageExtension(mimeType);
  if (!extension) throw new Error('Unsupported media type.');
  return objectKey(ownerId, extension, now);
}

/**
 * A key for one of the site's logos or its icon: files the library does not hold, in the
 * grammar that backup, restore and reset accept. SVG is in that grammar for these alone --
 * the library's own types, and the checks on its tables, do not include it.
 */
export function createBrandObjectKey(ownerId: string, extension: 'jpg' | 'png' | 'svg' | 'webp', now = new Date()): string {
  return objectKey(ownerId, extension, now);
}
