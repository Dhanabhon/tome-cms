/**
 * What the import sheet and the server agree on about a Markdown file: how its pictures are told
 * apart and matched to files the owner drops, and the warnings a report can carry.
 */

/** The text of one file. The admin's JSON body is capped at 1 MB and carries this with its wrapper. */
export const MAX_MARKDOWN_BYTES = 900_000;

/** The words of a skipped picture's line, in the post's language, not the admin's. */
export const MISSING_IMAGE = { th: 'รูปที่ขาด', en: 'Missing image' } as const;

export type PictureKind = 'local' | 'remote' | 'refused';

export interface ImportPicture {
  /** The address exactly as the file writes it: the key a match is sent back under. */
  src: string;
  /** The file name a dropped file is matched against, as written; '' for a refused picture. */
  name: string;
  kind: PictureKind;
  where: 'body' | 'cover';
}

export type ImportWarning =
  | { code: 'frontmatter-unreadable' }
  | { code: 'status-ignored' }
  | { code: 'date-unreadable' }
  | { code: 'html-removed'; count: number }
  | { code: 'links-removed'; count: number }
  | { code: 'task-list' }
  | { code: 'category-missing'; names: string[] }
  | { code: 'slug-changed'; slug: string };

function kindOf(src: string): PictureKind {
  if (/^https?:\/\//i.test(src)) return 'remote';
  // Any other scheme (data:, javascript:, file:) and a protocol-relative address are refused.
  if (src.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(src)) return 'refused';
  return src.trim() ? 'local' : 'refused';
}

function fileName(src: string): string {
  const path = src.split(/[?#]/, 1)[0] ?? '';
  const last = path.slice(path.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

export function describePicture(src: string, where: 'body' | 'cover'): ImportPicture {
  const kind = kindOf(src);
  return { src, name: kind === 'refused' ? '' : fileName(src), kind, where };
}

/** What a picture is called in the sheet and in its missing-picture line. */
export function pictureLabel(picture: ImportPicture): string {
  return picture.name || picture.src.slice(0, 40);
}

/** A cover lives in the library, so one from another site needs a file as well. */
export function needsFile(picture: ImportPicture): boolean {
  return picture.kind === 'local' || (picture.kind === 'remote' && picture.where === 'cover');
}

/**
 * Gives each dropped file to every picture with its name, ignoring case. Matches already made are
 * kept; a file dropped again under the same name replaces the earlier one.
 */
export function matchFiles<F extends { name: string }>(
  pictures: readonly ImportPicture[],
  files: readonly F[],
  current: ReadonlyMap<string, F> = new Map(),
): Map<string, F> {
  const byName = new Map(files.map((file) => [file.name.toLowerCase(), file]));
  const next = new Map(current);
  for (const picture of pictures) {
    const file = picture.name ? byName.get(picture.name.toLowerCase()) : undefined;
    if (file) next.set(picture.src, file);
  }
  return next;
}
