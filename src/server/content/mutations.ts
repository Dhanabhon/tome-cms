import slugify from 'slugify';
import { z } from 'zod';

import { editorDocumentSchema, hasMeaningfulContent, hasMeaningfulHtml } from '../../lib/editor-content';
import type { PostStatus } from '../../types/cms';
import { HttpError } from '../http/errors';
import { prepareEditorContent, ValidationError, type StoredEditorContent } from './editor';

export const normalizedContentSlugSchema = z.string().trim().min(1).max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const contentSlugSchema = z.union([
  normalizedContentSlugSchema,
  z.literal(''),
]);

export const contentMutationSchema = z.object({
  title: z.string().trim().min(1).max(200),
  slug: contentSlugSchema,
  contentJson: editorDocumentSchema,
  metaTitle: z.string().trim().max(70).nullable(),
  metaDescription: z.string().trim().max(320).nullable(),
  status: z.enum(['draft', 'published']),
  updatedAt: z.iso.datetime({ offset: true }).optional(),
}).strict();

export const statusMutationSchema = z.object({
  id: z.uuid(),
  status: z.enum(['draft', 'published']),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict();

export const deleteMutationSchema = z.object({
  id: z.uuid(),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict();

export function prepareContent(input: { contentJson: unknown; status: PostStatus }): StoredEditorContent {
  let content: StoredEditorContent;
  try {
    content = prepareEditorContent({ contentJson: input.contentJson });
  } catch (error) {
    if (error instanceof ValidationError || error instanceof z.ZodError) {
      throw new HttpError(400, 'The editor content is invalid.');
    }
    throw error;
  }
  if (input.status === 'published'
    && (!hasMeaningfulContent(content.contentJson) || !hasMeaningfulHtml(content.contentHtml))) {
    // The sentence is the API's, in the API's English. The code is for the admin, which
    // has this same refusal written in the owner's language.
    throw new HttpError(400, 'Add content before publishing.', { code: 'content_required' });
  }
  return content;
}

export function normalizedContentSlug(prefix: 'page' | 'post', requested: string, title: string, id: string): string {
  const normalized = slugify(requested || title, { lower: true, strict: true, trim: true })
    .slice(0, 160)
    .replace(/-+$/, '');
  return normalized || `${prefix}-${id.slice(0, 8)}`;
}

/**
 * Naming for a duplicate.
 *
 * (locale, slug) is unique, so a copy cannot keep the slug it was made from -- this
 * is a constraint, not a nicety. The first candidate is the readable one; the second
 * carries a slice of the copy's own fresh id and exists for when the readable one is
 * already taken, which is what happens the second time you duplicate the same thing.
 *
 * Both are trimmed so the suffix survives the length cap rather than being cut off
 * by it, and any hyphen left dangling by that trim is removed so the result still
 * matches the slug pattern.
 */
export function duplicateSlugCandidates(slug: string, id: string): [string, string] {
  const withSuffix = (suffix: string) =>
    `${slug.slice(0, 160 - suffix.length).replace(/-+$/, '')}${suffix}`;
  return [withSuffix('-copy'), withSuffix(`-copy-${id.slice(0, 8)}`)];
}

/**
 * Two rows with the same title, one of them a draft, is a puzzle rather than a list.
 * The marker follows the content's own language, not the admin's, because it becomes
 * part of the title and the writer will edit it in that language.
 */
export function duplicateTitle(title: string, locale: 'th' | 'en'): string {
  const suffix = locale === 'th' ? ' (สำเนา)' : ' (copy)';
  return `${title.slice(0, 200 - suffix.length).trim()}${suffix}`;
}

export function assertCurrentVersion(current: Date, requested: string, noun: 'page' | 'post'): void {
  if (current.getTime() !== new Date(requested).getTime()) {
    throw new HttpError(409, `This ${noun} changed elsewhere. Reload the page and try again.`);
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
