import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { isAbsolute, posix, relative, resolve, sep } from 'node:path';

import { MAX_MARKDOWN_BYTES } from '../../lib/markdown-import';
import { documentTypeForName, MAX_DOCUMENT_FILE_BYTES, MAX_IMAGE_BYTES } from '../../lib/media';
import { RESERVED_PAGE_SLUGS } from '../../lib/pages';
import { contentSlug, SLUG, SLUG_LENGTH } from '../../lib/slug';
import type { EditorDocument, EditorNode } from '../../types/cms';
import { parseEditorContent, ValidationError } from '../content/editor';
import { parseMarkdownPost } from '../content/markdown-import';
import { detectImageType } from '../media/image';
import { ArchiveInputError, readFrontMatter, readManifest, type ArchiveCategory, type ArchiveManifest, type FrontMatter } from './archive-format';

/*
 * What `tome import` would do with an archive from `tome export`, or a directory written the same
 * way by hand: every file is read and checked, and the site only asked which slugs, categories and
 * files it already has. Nothing is written. Anything outside the layout, a front matter that does
 * not read, or a file the File Manager would refuse stops the whole import here, naming the file.
 */

type Kind = 'post' | 'page';
type Locale = 'th' | 'en';

export interface ImportPlan {
  create: Array<{ kind: Kind; locale: Locale; slug: string; path: string; source: 'tome.json' | 'md' }>;
  skip: Array<{ path: string; reason: 'slug_taken' }>;
  media: { upload: number; reuse: number };
  categoriesToCreate: string[];
  groupsSplit: Array<{ translation: string; skipped: string[] }>;
}

/** What the plan asks of the site. The database answers in production; a test can answer instead. */
export interface SiteReader {
  takenSlugs(kind: Kind, locale: Locale, slugs: string[]): Promise<Set<string>>;
  categories(ownerId: string): Promise<Array<{ id: string; name: string; is_default: boolean }>>;
  media(ownerId: string, checksums: string[]): Promise<Array<{ id: string; checksum_sha256: string; size_bytes: number | string }>>;
}

/** A file under `media/`, by its path in the archive. */
export interface ArchiveFile {
  path: string;
  /** What the library will call it: the manifest's name, or the file's own. */
  name: string;
  size: number;
  /** Base64, as the File Manager stores it. */
  sha256: string;
}

/** An item to create, with what apply needs to write it. */
export interface PlannedItem {
  kind: Kind;
  locale: Locale;
  slug: string;
  /** The `.md`: it carries the front matter, and every refusal about the item names it. */
  path: string;
  source: 'tome.json' | 'md';
  frontMatter: Partial<FrontMatter> & { title: string };
  /** The exact document, or the one the `.md` body converts to; its files not yet relinked. */
  document: EditorDocument;
  /** The group's categories, by name: the union of its items' lists. */
  categories: string[];
  group: string;
  /** Archive paths of the files it uses: by the source site's id, by address as written, and the cover. */
  files: { ids: Map<string, string>; pictures: Map<string, string>; cover: string | null };
  /** Files it names that the archive does not hold. */
  missing: number;
}

export interface PlanDetail {
  items: PlannedItem[];
  files: Map<string, ArchiveFile>;
  /** One file for each distinct content the items use that the library does not have yet. */
  upload: ArchiveFile[];
  /** `fileKey` to the library item already holding that content. */
  reuse: Map<string, string>;
  /** Each category on the site, by its name in lower case. */
  categories: Map<string, string>;
  /** The manifest's word on each category, by its name in lower case: its address and descriptions. */
  archiveCategories: Map<string, ArchiveCategory>;
}

/** Two files with the same bytes are one file to the library. */
export function fileKey(file: ArchiveFile): string {
  return `${file.sha256}:${file.size}`;
}

const LOCALES: ReadonlySet<string> = new Set(['th', 'en']);
const ITEM = /^(.+)\.(md|tome\.json)$/;
// A pretty-printed document is a few times the size of the one stored, which is capped at 1 MB.
const MAX_EXACT_BYTES = 8 * 1024 * 1024;
// A body the converter takes, with as much again for the front matter, which is a few fields.
const MAX_ITEM_MARKDOWN_BYTES = 2 * MAX_MARKDOWN_BYTES;

/**
 * The slug an import stores, which the plan checks and apply writes as it is. One the archive gives
 * (its front matter's, or else its file's name) that is already valid is kept byte for byte, so a
 * move keeps every address: `contentSlug` would split some Thai runs that the site stored whole.
 * Any other is made one from it, or from the title when it has no words; a title with none either
 * leaves it empty, and the write gives it `post-<id>` or `page-<id>`.
 */
export function importSlug(kind: Kind, written: string, title: string): string {
  const slug = written.normalize('NFC').trim();
  if (SLUG.test(slug) && slug.length <= SLUG_LENGTH && !(kind === 'page' && RESERVED_PAGE_SLUGS.has(slug))) return slug;
  return contentSlug(slug) || contentSlug(title);
}

/** Every read goes through here: a path, from a manifest or a document, never leaves the archive. */
function archivePath(root: string, path: string): string {
  const full = resolve(root, ...path.split('/'));
  const within = relative(resolve(root), full);
  if (!within || within.startsWith(`..${sep}`) || within === '..' || isAbsolute(within)) throw new ArchiveInputError('layout_invalid', path);
  return full;
}

export async function readArchiveFile(root: string, path: string): Promise<Buffer> {
  return readFile(archivePath(root, path));
}

/** An item's file, refused by its size before a byte of it is held in memory. */
async function readItemFile(root: string, path: string, limit: number): Promise<Buffer> {
  if ((await lstat(archivePath(root, path))).size > limit) throw new ArchiveInputError('content_invalid', path);
  return readArchiveFile(root, path);
}

interface Layout {
  manifest: boolean;
  items: Map<string, { kind: Kind; locale: Locale; stem: string; md?: string; json?: string }>;
  media: string[];
}

/** The directory's entries, without following a link: anything the layout has no place for is refused. */
async function readLayout(root: string): Promise<Layout> {
  const layout: Layout = { manifest: false, items: new Map(), media: [] };
  const entries = async (path: string) => readdir(path ? resolve(root, ...path.split('/')) : root, { withFileTypes: true });
  const join = (parent: string, name: string) => (parent ? `${parent}/${name}` : name);
  const walkMedia = async (path: string): Promise<void> => {
    for (const entry of await entries(path)) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walkMedia(child);
      else if (entry.isFile()) layout.media.push(child);
      else throw new ArchiveInputError('layout_invalid', child);
    }
  };
  for (const top of await entries('')) {
    if (top.name === 'manifest.json' && top.isFile()) layout.manifest = true;
    else if (top.name === 'media' && top.isDirectory()) await walkMedia('media');
    else if ((top.name === 'posts' || top.name === 'pages') && top.isDirectory()) {
      const kind: Kind = top.name === 'posts' ? 'post' : 'page';
      for (const folder of await entries(top.name)) {
        const localePath = join(top.name, folder.name);
        if (!folder.isDirectory() || !LOCALES.has(folder.name)) throw new ArchiveInputError('layout_invalid', localePath);
        for (const file of await entries(localePath)) {
          const path = join(localePath, file.name);
          const match = ITEM.exec(file.name);
          if (!file.isFile() || !match) throw new ArchiveInputError('layout_invalid', path);
          const key = `${localePath}/${match[1]}`;
          const item = layout.items.get(key) ?? { kind, locale: folder.name as Locale, stem: match[1]! };
          if (match[2] === 'md') item.md = path;
          else item.json = path;
          layout.items.set(key, item);
        }
      }
    } else throw new ArchiveInputError('layout_invalid', top.name);
  }
  return layout;
}

async function readMedia(root: string, paths: string[], manifest: ArchiveManifest | null): Promise<Map<string, ArchiveFile>> {
  const names = new Map(Object.values(manifest?.media ?? {}).map(({ path, name }) => [path, name]));
  const files = new Map<string, ArchiveFile>();
  for (const path of paths.sort()) {
    // Read whole, up to 25 MiB each: the File Manager keeps no larger file.
    if ((await lstat(archivePath(root, path))).size > MAX_DOCUMENT_FILE_BYTES) throw new ArchiveInputError('media_too_large', path);
    const bytes = await readArchiveFile(root, path);
    const name = names.get(path) ?? posix.basename(path);
    if (detectImageType(bytes)) {
      if (bytes.length > MAX_IMAGE_BYTES) throw new ArchiveInputError('media_too_large', path);
    } else if (!documentTypeForName(name) || !bytes.length) {
      throw new ArchiveInputError('media_type_unsupported', path);
    } else if (bytes.length > MAX_DOCUMENT_FILE_BYTES) {
      throw new ArchiveInputError('media_too_large', path);
    }
    files.set(path, { path, name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('base64') });
  }
  return files;
}

/** Each file a document names by its id, in a node or a mark. */
function documentMediaIds(document: EditorDocument): Set<string> {
  const ids = new Set<string>();
  const pending: EditorNode[] = [document];
  for (let node = pending.pop(); node; node = pending.pop()) {
    for (const holder of [node, ...(node.marks ?? [])]) {
      const id = holder.attrs?.mediaId;
      if (typeof id === 'string') ids.add(id);
    }
    pending.push(...(node.content ?? []));
  }
  return ids;
}

/** The archive path an item's relative address leads to, when it is a file under `media/`. */
function linkedFile(itemPath: string, address: string, files: ReadonlyMap<string, ArchiveFile>): string | null {
  const written = address.split(/[?#]/, 1)[0] ?? '';
  if (!written || written.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(written)) return null;
  let decoded = written;
  try {
    decoded = decodeURIComponent(written);
  } catch {
    // As written, then.
  }
  for (const candidate of [written, decoded]) {
    const path = posix.normalize(posix.join(posix.dirname(itemPath), candidate));
    if (path.startsWith('media/') && files.has(path)) return path;
  }
  return null;
}

async function readItem(
  root: string,
  entry: { kind: Kind; locale: Locale; stem: string; md?: string; json?: string },
  manifest: ArchiveManifest | null,
  files: ReadonlyMap<string, ArchiveFile>,
): Promise<Omit<PlannedItem, 'categories' | 'group'> & { translation: string | null }> {
  if (!entry.md) throw new ArchiveInputError('layout_invalid', entry.json!);
  const path = entry.md;
  const text = (await readItemFile(root, path, MAX_ITEM_MARKDOWN_BYTES)).toString('utf8');
  const { frontMatter, body } = readFrontMatter(text, path);
  if (frontMatter.language && frontMatter.language !== entry.locale) throw new ArchiveInputError('front_matter_invalid', path, 'language');
  if (frontMatter.categories?.some((name) => !name.trim() || name.trim().length > 80)) throw new ArchiveInputError('front_matter_invalid', path, 'categories');

  const ids = new Map<string, string>();
  const pictures = new Map<string, string>();
  let missing = 0;
  let document: EditorDocument;
  if (entry.json) {
    const exact = await readItemFile(root, entry.json, MAX_EXACT_BYTES);
    try {
      // The editor's own check of a document's shape and bounds; its files are checked on write.
      document = parseEditorContent({ contentJson: JSON.parse(exact.toString('utf8')) });
    } catch {
      throw new ArchiveInputError('content_invalid', entry.json);
    }
    for (const id of documentMediaIds(document)) {
      const file = manifest?.media[id]?.path;
      if (file && files.has(file)) ids.set(id, file);
      else missing += 1;
    }
  } else {
    if (Buffer.byteLength(body) > MAX_MARKDOWN_BYTES) throw new ArchiveInputError('content_invalid', path);
    let parsed;
    try {
      // The admin's converter, given only a title: the archive's own fields are read above.
      parsed = parseMarkdownPost(`---\ntitle: draft\n---\n${body}`, posix.basename(path));
    } catch (error) {
      if (error instanceof ValidationError) throw new ArchiveInputError('content_invalid', path);
      throw error;
    }
    document = parsed.document;
    for (const picture of parsed.pictures) {
      if (picture.kind === 'remote') continue;
      const file = linkedFile(path, picture.src, files);
      if (file) pictures.set(picture.src, file);
      else missing += 1;
    }
  }
  const cover = frontMatter.cover ? linkedFile(path, frontMatter.cover, files) : null;
  if (frontMatter.cover && !cover) missing += 1;
  return {
    kind: entry.kind,
    locale: entry.locale,
    // A hand-written file with no slug is at the address its name gives.
    slug: importSlug(entry.kind, frontMatter.slug ?? entry.stem, frontMatter.title),
    path,
    source: entry.json ? 'tome.json' : 'md',
    frontMatter,
    document,
    files: { ids, pictures, cover },
    missing,
    translation: frontMatter.translation ?? null,
  };
}

const databaseReader: SiteReader = {
  async takenSlugs(kind, locale, slugs) {
    if (!slugs.length) return new Set();
    const { db } = await import('../db/client');
    const rows = kind === 'post'
      ? await db.selectFrom('posts').select('slug').where('locale', '=', locale).where('slug', 'in', slugs).execute()
      : await db.selectFrom('pages').select('slug').where('locale', '=', locale).where('slug', 'in', slugs).execute();
    return new Set(rows.map(({ slug }) => slug));
  },
  async categories(ownerId) {
    const { db } = await import('../db/client');
    return db.selectFrom('categories').select(['id', 'name', 'is_default']).where('owner_id', '=', ownerId).execute();
  },
  async media(ownerId, checksums) {
    if (!checksums.length) return [];
    const { db } = await import('../db/client');
    return db.selectFrom('media_items').select(['id', 'checksum_sha256', 'size_bytes'])
      .where('owner_id', '=', ownerId).where('state', '=', 'ready').where('checksum_sha256', 'in', checksums)
      .orderBy('id').execute();
  },
};

/** The plan, and the items, files and ids behind it, for apply to write. */
export async function buildPlan(root: string, ownerId: string, site: SiteReader = databaseReader): Promise<{ plan: ImportPlan; detail: PlanDetail }> {
  const layout = await readLayout(root);
  const manifest = layout.manifest ? readManifest((await readArchiveFile(root, 'manifest.json')).toString('utf8')) : null;
  const files = await readMedia(root, layout.media, manifest);
  const entries = [...layout.items.values()].sort((left, right) => ((left.md ?? left.json)! < (right.md ?? right.json)! ? -1 : 1));
  const read = [];
  for (const entry of entries) read.push(await readItem(root, entry, manifest, files));

  const taken = new Set<string>();
  for (const kind of ['post', 'page'] as const) {
    for (const locale of ['th', 'en'] as const) {
      const slugs = read.filter((item) => item.kind === kind && item.locale === locale).map(({ slug }) => slug);
      for (const slug of await site.takenSlugs(kind, locale, [...new Set(slugs)])) taken.add(`${kind}/${locale}/${slug}`);
    }
  }

  const plan: ImportPlan = { create: [], skip: [], media: { upload: 0, reuse: 0 }, categoriesToCreate: [], groupsSplit: [] };
  const groups = new Map<string, { translation: string | null; created: Array<typeof read[number]>; skipped: string[] }>();
  for (const item of read) {
    const group = `${item.kind}:${item.translation ?? item.path}`;
    const members = groups.get(group) ?? { translation: item.translation, created: [], skipped: [] };
    groups.set(group, members);
    const address = `${item.kind}/${item.locale}/${item.slug}`;
    // An address the site has, or that an earlier file in the archive takes: never overwritten. A
    // title with no words leaves no slug; the write gives each such item one of its own.
    if (item.slug && taken.has(address)) {
      plan.skip.push({ path: item.path, reason: 'slug_taken' });
      members.skipped.push(item.path);
      continue;
    }
    if (item.slug) taken.add(address);
    // A group holds one edition in each language.
    if (members.created.some(({ locale }) => locale === item.locale)) throw new ArchiveInputError('front_matter_invalid', item.path, 'translation');
    members.created.push(item);
    plan.create.push({ kind: item.kind, locale: item.locale, slug: item.slug, path: item.path, source: item.source });
  }

  const categories = new Map((await site.categories(ownerId)).map(({ id, name }) => [name.toLowerCase(), id]));
  const toCreate = new Map<string, string>();
  const items: PlannedItem[] = [];
  for (const [group, members] of groups) {
    if (members.translation && members.created.length && members.skipped.length) {
      plan.groupsSplit.push({ translation: members.translation, skipped: members.skipped });
    }
    const names = new Map<string, string>();
    for (const item of members.created) {
      for (const written of item.kind === 'post' ? item.frontMatter.categories ?? [] : []) {
        const name = written.trim();
        const lower = name.toLowerCase();
        if (!names.has(lower)) names.set(lower, name);
        if (!categories.has(lower) && !toCreate.has(lower)) toCreate.set(lower, name);
      }
    }
    for (const { translation: _translation, ...item } of members.created) items.push({ ...item, categories: [...names.values()], group });
  }
  plan.categoriesToCreate = [...toCreate.values()];
  // In the archive's order again, so groups are written as their first file comes.
  items.sort((left, right) => (left.path < right.path ? -1 : 1));

  const used = new Map<string, ArchiveFile>();
  for (const item of items) {
    for (const path of [...item.files.ids.values(), ...item.files.pictures.values(), item.files.cover]) {
      const file = path ? files.get(path) : undefined;
      if (file && !used.has(fileKey(file))) used.set(fileKey(file), file);
    }
  }
  const existing = await site.media(ownerId, [...new Set([...used.values()].map(({ sha256 }) => sha256))]);
  const reuse = new Map<string, string>();
  for (const row of existing) {
    const key = `${row.checksum_sha256}:${Number(row.size_bytes)}`;
    if (used.has(key) && !reuse.has(key)) reuse.set(key, row.id);
  }
  const upload = [...used.values()].filter((file) => !reuse.has(fileKey(file)));
  plan.media = { upload: upload.length, reuse: reuse.size };
  const archiveCategories = new Map((manifest?.categories ?? []).map((entry) => [entry.name.toLowerCase(), entry]));
  return { plan, detail: { items, files, upload, reuse, categories, archiveCategories } };
}

/** What an import of this directory would do. Nothing is written. */
export async function planImport(root: string, ownerId: string, site: SiteReader = databaseReader): Promise<ImportPlan> {
  return (await buildPlan(root, ownerId, site)).plan;
}
