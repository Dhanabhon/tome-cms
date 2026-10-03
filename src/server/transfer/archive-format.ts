import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

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
}

/** A refusal of something in an archive, by its code and the file it is about. */
export class ArchiveInputError extends Error {
  constructor(readonly code: string, readonly file: string) {
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

const manifestSchema = z.object({
  format: z.literal(ARCHIVE_FORMAT),
  version: z.literal(1),
  createdAt: z.string(),
  applicationVersion: z.string(),
  publicUrl: z.string(),
  counts: z.object({ posts: count, pages: count, media: count }),
  media: z.record(z.string(), z.object({
    path: z.string().startsWith('media/').refine((path) => !path.split('/').includes('..')),
    name: z.string(),
    type: z.string(),
    sha256: z.string(),
    size: count,
  })),
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
  if (!parsed.success) throw new ArchiveInputError('front_matter_invalid', file);
  return { frontMatter: parsed.data, body: source.slice(match[0].length).replace(/^\r?\n/, '') };
}
