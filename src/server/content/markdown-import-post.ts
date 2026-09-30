import { createHash, randomUUID } from 'node:crypto';

import { z } from 'zod';

import { MAX_MARKDOWN_BYTES, type ImportPicture, type ImportWarning } from '../../lib/markdown-import';
import { contentSlug } from '../../lib/slug';
import type { Post } from '../../types/cms';
import { db } from '../db/client';
import { HttpError } from '../http/errors';
import { ValidationError } from './editor';
import { MarkdownTooComplexError, placePictures, type ParsedMarkdownPost } from './markdown-import';
import { MarkdownBusyError, readMarkdownPost } from './markdown-import-run';
import { createPost } from './posts';

export const markdownImportSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  text: z.string(),
  /** The address as the file writes it, to the id of a picture already uploaded for it. */
  pictures: z.record(z.string().min(1).max(4096), z.uuid()).optional()
    .refine((pictures) => !pictures || Object.keys(pictures).length <= 500, 'Too many pictures.'),
}).strict();

export type MarkdownImportInput = z.infer<typeof markdownImportSchema>;

export interface MarkdownImportPreview {
  title: string;
  /** What the post's address will be; '' when it is made from the id, as for a title with no Latin or Thai letters. */
  slug: string;
  locale: 'th' | 'en';
  /** The site's names of the categories the file matched. */
  categories: string[];
  pictures: ImportPicture[];
  warnings: ImportWarning[];
}

interface Resolved {
  parsed: ParsedMarkdownPost;
  locale: 'th' | 'en';
  categories: { id: string; name: string }[];
  slug: string;
  warnings: ImportWarning[];
}

/**
 * The parser's refusals as the admin's errors: a file too complex (or too slow) carries its warning
 * for the sheet to show, and so does a second file read while one is being read.
 */
async function readFile(text: string, fileName: string): Promise<ParsedMarkdownPost> {
  try {
    return await readMarkdownPost(text, fileName);
  } catch (error) {
    if (error instanceof MarkdownTooComplexError) throw new HttpError(413, error.message, { warning: error.warning });
    if (error instanceof MarkdownBusyError) throw new HttpError(429, error.message, { warning: { code: 'busy' } satisfies ImportWarning });
    if (error instanceof ValidationError) throw new HttpError(400, error.message);
    throw error;
  }
}

async function resolve(ownerId: string, input: MarkdownImportInput): Promise<Resolved> {
  if (new TextEncoder().encode(input.text).byteLength > MAX_MARKDOWN_BYTES) throw new HttpError(413, 'The file is too large.');
  const parsed = await readFile(input.text, input.fileName);
  const settings = await db.selectFrom('site_settings').select('default_locale')
    .where('id', '=', true).where('owner_id', '=', ownerId).executeTakeFirst();
  if (!settings) throw new HttpError(503, 'Site settings are unavailable.');
  const locale = parsed.locale ?? settings.default_locale;

  const rows = await db.selectFrom('categories').select(['id', 'name']).where('owner_id', '=', ownerId).execute();
  const byName = new Map(rows.map((row) => [row.name.toLowerCase(), row]));
  const categories = [...new Map(parsed.categoryNames
    .map((name) => byName.get(name.toLowerCase()))
    .filter((row): row is { id: string; name: string } => Boolean(row))
    .map((row) => [row.id, row])).values()];
  const missing = parsed.categoryNames.filter((name) => !byName.has(name.toLowerCase()));
  const warnings = [...parsed.warnings];
  if (missing.length) warnings.push({ code: 'category-missing', names: missing });

  const isTaken = async (candidate: string) => Boolean(await db.selectFrom('posts').select('id')
    .where('locale', '=', locale).where('slug', '=', candidate).executeTakeFirst());
  let slug = contentSlug(parsed.slug || parsed.title);
  if (slug && await isTaken(slug)) {
    // The same file gets the same suffix, so the preview shows the address the import will make;
    // a file imported again after that finds it taken too, and gets one of its own.
    const stem = slug.slice(0, 151).replace(/-+$/, '');
    const seed = createHash('sha256').update(`${ownerId}\n${slug}\n${input.text}`).digest('hex').slice(0, 8);
    slug = `${stem}-${seed}`;
    if (await isTaken(slug)) slug = `${stem}-${randomUUID().slice(0, 8)}`;
    warnings.push({ code: 'slug-changed', slug });
  }
  return { parsed, locale, categories, slug, warnings };
}

/** What an import of this file would make. Nothing is saved. */
export async function previewMarkdownImport(ownerId: string, input: MarkdownImportInput): Promise<MarkdownImportPreview> {
  const { parsed, locale, categories, slug, warnings } = await resolve(ownerId, input);
  return { title: parsed.title, slug, locale, categories: categories.map(({ name }) => name), pictures: parsed.pictures, warnings };
}

const SIZE_CHECKS = new Set(['posts_content_json_check', 'posts_content_html_check']);

/** The database refused the post for its size, which the preview's measure should have caught first. */
function isTooBigToStore(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23514'
    && 'constraint' in error && SIZE_CHECKS.has(String(error.constraint));
}

/**
 * Makes the draft. The file is parsed again rather than kept from the preview: it takes well under a
 * tenth of a second, and nothing has to live between the two calls. The pictures were uploaded by
 * the sheet; `createPost` checks each is a ready picture of this owner.
 */
export async function importMarkdownPost(ownerId: string, input: MarkdownImportInput): Promise<{ post: Post; warnings: ImportWarning[] }> {
  const { parsed, locale, categories, slug, warnings } = await resolve(ownerId, input);
  const matches = new Map(Object.entries(input.pictures ?? {}));
  const post = await createPost(ownerId, {
    title: parsed.title,
    slug,
    contentJson: placePictures(parsed.document, matches, locale),
    metaTitle: parsed.metaTitle,
    metaDescription: parsed.metaDescription,
    status: 'draft',
    publishedAt: parsed.publishedAt,
    categoryIds: categories.map(({ id }) => id),
    coverMediaId: parsed.cover ? matches.get(parsed.cover.src) ?? null : null,
    excerpt: parsed.excerpt,
    // Spelled out: this call does not pass through `createPostSchema`, whose default it would get.
    showCover: true,
    locale,
  }).catch((error: unknown) => {
    if (!isTooBigToStore(error)) throw error;
    const tooBig = new MarkdownTooComplexError('size');
    throw new HttpError(413, tooBig.message, { warning: tooBig.warning });
  });
  return { post, warnings };
}
