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
    throw new HttpError(400, 'Add content before publishing.');
  }
  return content;
}

export function normalizedContentSlug(prefix: 'page' | 'post', requested: string, title: string, id: string): string {
  const normalized = slugify(requested || title, { lower: true, strict: true, trim: true })
    .slice(0, 160)
    .replace(/-+$/, '');
  return normalized || `${prefix}-${id.slice(0, 8)}`;
}

export function assertCurrentVersion(current: Date, requested: string, noun: 'page' | 'post'): void {
  if (current.getTime() !== new Date(requested).getTime()) {
    throw new HttpError(409, `This ${noun} changed elsewhere. Reload the page and try again.`);
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
