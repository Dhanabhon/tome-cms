import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

import { ACCEPTED_MEDIA_TYPES } from '../../lib/media';
import { SLUG_LENGTH } from '../../lib/slug';
import { isTomeObjectKey, isUuid } from '../media/keys';

/*
 * The Markdown archive `tome export` writes and `tome import` reads: where each file lives in it,
 * its manifest, and the front matter at the head of each `.md`. A person may write one by hand, so
 * the reader takes any file with a title, and refuses a field it would have to guess at.
 */

export const ARCHIVE_FORMAT = 'tomecms-markdown';

export interface ArchiveMediaFile {
  /** `media/<object key>`. */
  path: string;
  name: string;
  type: string;
  /** Base64, as the File Manager stores it. */
  sha256: string;
  size: number;
}

/** A category as front matter cannot say it: front matter names it, this carries the rest. */
export interface ArchiveCategory {
  name: string;
  slug: string;
  descriptionTh: string;
  descriptionEn: string;
}

export interface ArchiveManifest {
  format: 'tomecms-markdown';
  version: 1;
  createdAt: string;
  applicationVersion: string;
  publicUrl: string;
  counts: { posts: number; pages: number; media: number };
  /**
   * Each exported file by its id on the source site. A document names its files by `mediaId`,
   * a video's poster by nothing else, so this is how an import finds them.
   */
  media: Record<string, ArchiveMediaFile>;
  /**
   * The address and descriptions of each category the posts are in, but the default. An archive
   * made before 1.20 has none, and an import then makes each address from the name.
   */
  categories?: ArchiveCategory[];
  /**
   * What the default category was called (1.21 on). An import puts a post that names it in the
   * site's own default, which keeps its name. Without it, the default is Uncategorized, as it was.
   */
  defaultCategory?: string;
}

/** A refusal of something in an archive, by its code, the file it is about and, for front matter, the field. */
export class ArchiveInputError extends Error {
  constructor(readonly code: string, readonly file: string, readonly field?: string) {
    super(`${code}: ${file}`);
  }
}

export function itemPath(kind: 'post' | 'page', locale: 'th' | 'en', slug: string, ext: '.md' | '.tome.json'): string {
  return `${kind}s/${locale}/${slug}${ext}`;
}

export function mediaPath(objectKey: string): string {
  return `media/${objectKey}`;
}

/** A file's address as an item links to it, from `posts/<locale>/` or `pages/<locale>/`. */
export function mediaLink(objectKey: string): string {
  return `../../${mediaPath(objectKey)}`;
}

const count = z.number().int().nonnegative();

const MEDIA_PREFIX = mediaPath('');

/**
 * An archive is untrusted, and an import opens each file the manifest names: so a path is only
 * ever one the export could have written, `media/` and an object key of TomeCMS's own grammar.
 */
const manifestSchema = z.object({
  format: z.literal(ARCHIVE_FORMAT),
  version: z.literal(1),
  createdAt: z.iso.datetime(),
  applicationVersion: z.string(),
  publicUrl: z.url(),
  counts: z.object({ posts: count, pages: count, media: count }),
  media: z.record(z.string().refine(isUuid), z.object({
    path: z.string().refine((path) => path.startsWith(MEDIA_PREFIX) && isTomeObjectKey(path.slice(MEDIA_PREFIX.length))),
    // The File Manager's own limit on a file's name (migration 006).
    name: z.string().min(1).max(255),
    type: z.enum(ACCEPTED_MEDIA_TYPES),
    // Base64, as the File Manager stores it.
    sha256: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
    size: count,
  })),
  // The slug is checked where it is used: one that is not a slug, or is taken, is made from the name.
  // Bounded as an edit in the category manager is, and exactly the four fields the export writes.
  categories: z.array(z.object({
    name: z.string().trim().min(1).max(80),
    slug: z.string().max(SLUG_LENGTH * 2),
    descriptionTh: z.string().trim().max(160),
    descriptionEn: z.string().trim().max(160),
  }).strict()).optional(),
  defaultCategory: z.string().trim().min(1).max(80).optional(),
}).refine((manifest) => manifest.counts.media === Object.keys(manifest.media).length);

export function readManifest(source: string): ArchiveManifest {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new ArchiveInputError('manifest_invalid', 'manifest.json');
  }
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) throw new ArchiveInputError('manifest_invalid', 'manifest.json');
  return parsed.data;
}

const date = z.string().refine((value) => !Number.isNaN(Date.parse(value)));

const frontMatterSchema = z.object({
  title: z.string(),
  slug: z.string(),
  language: z.enum(['th', 'en']),
  status: z.enum(['draft', 'published']),
  published: date.optional(),
  planned: date.optional(),
  updated: date,
  categories: z.array(z.string()).optional(),
  excerpt: z.string(),
  cover: z.string().optional(),
  show_cover: z.boolean().optional(),
  meta_title: z.string().optional(),
  meta_description: z.string().optional(),
  translation: z.string(),
});

export type FrontMatter = z.infer<typeof frontMatterSchema>;

// Only a title is needed; zod drops the keys it does not know.
const readSchema = frontMatterSchema.partial().required({ title: true });

// A file written on Windows has CRLF line endings, and often a byte order mark.
const FRONT_MATTER = /^\uFEFF?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

export function writeFrontMatter(fm: FrontMatter): string {
  // In the schema's order, absent fields left out; no folding, so a long title stays on its line.
  const ordered = frontMatterSchema.parse(fm);
  return `---\n${stringifyYaml(ordered, { lineWidth: 0 })}---\n`;
}

export function readFrontMatter(source: string, file: string): { frontMatter: Partial<FrontMatter> & { title: string }; body: string } {
  const match = FRONT_MATTER.exec(source);
  if (!match) throw new ArchiveInputError('front_matter_invalid', file);
  let value: unknown;
  try {
    value = parseYaml(match[1] ?? '');
  } catch {
    throw new ArchiveInputError('front_matter_invalid', file);
  }
  const parsed = readSchema.safeParse(value);
  if (!parsed.success) {
    // The first field it could not read; none when the block is not a mapping at all.
    const field = parsed.error.issues[0]?.path[0];
    throw new ArchiveInputError('front_matter_invalid', file, typeof field === 'string' ? field : undefined);
  }
  return { frontMatter: parsed.data, body: source.slice(match[0].length).replace(/^\r?\n/, '') };
}
