import { MarkdownManager } from '@tiptap/markdown';
import { parse as parseYaml } from 'yaml';

import { normalizeCodeLanguage } from '../../lib/code-languages';
import {
  describePicture,
  MISSING_IMAGE,
  pictureLabel,
  type ImportLimit,
  type ImportPicture,
  type ImportWarning,
} from '../../lib/markdown-import';
import type { EditorDocument, EditorNode } from '../../types/cms';
import { extensions, ValidationError } from './editor';

/**
 * One Markdown file, read into what a new post is made of. No database: the service decides
 * language, categories and slug against the site. The parser is built from the server's own
 * extensions, so nothing it makes is a node the server cannot render. On a server there is no
 * `window`, so raw HTML comes out as text, never as markup; it is then removed here.
 */
const markdown = new MarkdownManager({ extensions });

const FRONTMATTER = /^---[ \t]*\n(?:([\s\S]*?)\n)?---[ \t]*(?:\n|$)/;
// ponytail: matched on the raw text, so a task item inside a code block also warns; it is only a warning.
const TASK_ITEM = /^[ \t]*[-*+] \[[ xX]\] /m;
// A footnote reference comes out as a link to the footnote's words; only these are real. An address
// starting with two slashes (or a slash and a backslash) names another site, like a picture's does.
const KEPT_LINK = /^(?:https?:|\/(?![/\\])|#)/i;

/*
 * Limits on what one file may ask of the server. The Markdown lexer is slower than linear: every
 * block re-reads the rest of the file, and a paragraph's marks are slower than linear in their
 * number, so a 900 KB file of tiny blocks or marks takes minutes and stops the whole site. They
 * are counted on the text, in one pass, before any lexing; a file over one is refused. A long
 * post (100,000 words, 500 pictures) uses a fraction of each.
 */
export const MAX_FRONTMATTER = 20_000;
export const MAX_BLOCKS = 4_000;
export const MAX_LINES = 12_000;
/** Characters that start a mark: emphasis, code, a link or tag, an escape, a bare address. */
export const MAX_INLINE = 40_000;
export const MAX_PICTURES = 2_000;
/** Levels of lists, quotes and tables inside each other; the server's own check stops a little past this. */
export const MAX_DEPTH = 40;
/** Different tags a file may hold; each is searched for in every text that has a `<`. */
export const MAX_HTML = 300;

// A block starts at a blank line, a heading, a quote, a fence or a rule; a list or a table is one.
const BLOCK_START = /^ {0,3}(?:#{1,6}(?:\s|$)|>|```|~~~|(?:[-*_][ \t]*){3,}$)|\n[ \t]*\n+/gm;
const FENCED = /^ {0,3}(```|~~~)[^\n]*\n[\s\S]*?(?:\n {0,3}\1[~`]*[ \t]*(?=\n|$)|(?![\s\S]))/gm;
const INLINE_START = /[<[*_`~\\]|https?:|www\./gi;
const PICTURE_START = /!\[/g;

/** A file that is too big or too deep to read; `warning` says which limit, for the sheet to show. */
export class MarkdownTooComplexError extends ValidationError {
  constructor(readonly limit: ImportLimit) {
    super(limit === 'depth' ? 'This file is nested too deeply to import.' : 'This file is too long or too complex to import.');
  }

  get warning(): ImportWarning {
    return { code: 'too-complex', limit: this.limit };
  }
}

const count = (value: string, pattern: RegExp): number => value.match(pattern)?.length ?? 0;

function checkSize(body: string): void {
  if (count(body, PICTURE_START) > MAX_PICTURES) throw new MarkdownTooComplexError('pictures');
  if (count(body, BLOCK_START) > MAX_BLOCKS) throw new MarkdownTooComplexError('blocks');
  if (count(body, /\n/g) > MAX_LINES) throw new MarkdownTooComplexError('lines');
  // Code is not read for marks, so a long listing does not count against the post.
  if (count(body.replace(FENCED, ''), INLINE_START) > MAX_INLINE) throw new MarkdownTooComplexError('inline');
}

export interface ParsedMarkdownPost {
  title: string;
  /** As the file asked, trimmed; '' lets the post make one from its title. */
  slug: string;
  locale: 'th' | 'en' | null;
  publishedAt: string | null;
  categoryNames: string[];
  excerpt: string;
  metaTitle: string | null;
  metaDescription: string | null;
  cover: ImportPicture | null;
  document: EditorDocument;
  /** The cover first, then each body picture once, in the order the file has them. */
  pictures: ImportPicture[];
  warnings: ImportWarning[];
}

function text(value: unknown, max: number): string {
  if (typeof value === 'number') return String(value).slice(0, max);
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function readFrontmatter(yaml: string, warnings: ImportWarning[]): Record<string, unknown> {
  try {
    if (yaml.length > MAX_FRONTMATTER) throw new RangeError('Frontmatter too long');
    const value: unknown = parseYaml(yaml);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    if (value === null) return {};
  } catch {
    // Reported below.
  }
  warnings.push({ code: 'frontmatter-unreadable' });
  return {};
}

/** The raw text of every HTML token, found with the same lexer the parser uses. */
function htmlTokens(body: string): string[] {
  const found: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const token = value as { type?: unknown; raw?: unknown };
    if (token.type === 'html' && typeof token.raw === 'string' && token.raw.trim()) found.push(token.raw.trim());
    for (const child of Object.values(value)) if (child && typeof child === 'object') visit(child);
  };
  // Lexed a second time, only when there is a tag to find: the parser's own lexer is not reachable.
  if (body.includes('<')) visit(markdown.instance.lexer(body));
  return found;
}

const isTooDeep = (node: EditorNode, depth = 1): boolean =>
  depth > MAX_DEPTH || Boolean(node.content?.some((child) => isTooDeep(child, depth + 1)));

function plainText(node: EditorNode): string {
  return node.text ?? (node.content ?? []).map(plainText).join('');
}

function clean(node: EditorNode, html: readonly string[], counts: { links: number }, inCode: boolean): EditorNode | null {
  if (node.type === 'text') {
    const isCode = inCode || Boolean(node.marks?.some((mark) => mark.type === 'code'));
    let value = node.text ?? '';
    if (!isCode && value.includes('<')) for (const raw of html) value = value.split(raw).join('');
    if (!value.trim() && value !== node.text) return null;
    const marks = node.marks?.filter((mark) => {
      if (mark.type !== 'link') return true;
      const kept = KEPT_LINK.test(String(mark.attrs?.href ?? ''));
      if (!kept) counts.links += 1;
      return kept;
    });
    const next: EditorNode = { ...node, text: value };
    if (marks?.length) next.marks = marks;
    else delete next.marks;
    return next;
  }
  let attrs = node.attrs;
  if (node.type === 'heading' && Number(attrs?.level) > 3) attrs = { ...attrs, level: 3 };
  // The parser carries the fence's whole info string ("js", "ts title=x"); the post stores an id.
  if (node.type === 'codeBlock') attrs = { ...attrs, language: normalizeCodeLanguage(String(attrs?.language ?? '').split(/\s+/)[0]) };
  if (!node.content) return attrs === node.attrs ? node : { ...node, attrs };
  const content = node.content
    .map((child) => clean(child, html, counts, inCode || node.type === 'codeBlock'))
    .filter((child): child is EditorNode => child !== null);
  return { ...node, ...(attrs ? { attrs } : {}), content };
}

export function parseMarkdownPost(source: string, fileName: string): ParsedMarkdownPost {
  const input = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const warnings: ImportWarning[] = [];
  const found = FRONTMATTER.exec(input);
  const fields = found ? readFrontmatter(found[1] ?? '', warnings) : {};
  const body = found ? input.slice(found[0].length) : input;

  const status = fields.status === undefined ? 'draft' : String(fields.status).trim().toLowerCase();
  if (status !== 'draft' || fields.published === true || fields.draft === false) warnings.push({ code: 'status-ignored' });

  let publishedAt: string | null = null;
  if (fields.date !== undefined && fields.date !== null && fields.date !== '') {
    const date = fields.date instanceof Date ? fields.date : new Date(String(fields.date));
    if (Number.isNaN(date.getTime())) warnings.push({ code: 'date-unreadable' });
    else publishedAt = date.toISOString();
  }

  checkSize(body);
  const counts = { links: 0 };
  let blocks: EditorNode[];
  let htmlCount: number;
  try {
    const found = htmlTokens(body);
    htmlCount = found.length;
    const html = [...new Set(found)].sort((left, right) => right.length - left.length);
    if (html.length > MAX_HTML) throw new MarkdownTooComplexError('html');
    // A round trip through JSON drops the `content: undefined` the parser leaves on an inline picture,
    // which the server's check refuses as not JSON.
    const parsed = JSON.parse(JSON.stringify(markdown.parse(body))) as EditorDocument;
    blocks = (parsed.content ?? [])
      .map((node) => clean(node, html, counts, false))
      .filter((node): node is EditorNode => node !== null)
      // Markdown cannot write an empty paragraph on purpose; the parser adds them around pictures.
      .filter((node) => node.type !== 'paragraph' || Boolean(node.content?.length))
      .filter((node) => node.type !== 'heading' || Boolean(plainText(node).trim()));
    // Whether the lexer ran out of stack depends on the machine; this does not.
    if (blocks.some((node) => isTooDeep(node))) throw new MarkdownTooComplexError('depth');
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    // Nesting is the one thing the lexer cannot bound: it runs out of stack, and says so.
    if (error instanceof RangeError) throw new MarkdownTooComplexError('depth');
    throw new ValidationError('This file could not be read as Markdown.');
  }
  if (htmlCount) warnings.push({ code: 'html-removed', count: htmlCount });
  if (counts.links) warnings.push({ code: 'links-removed', count: counts.links });
  if (TASK_ITEM.test(body)) warnings.push({ code: 'task-list' });

  let title = text(fields.title, 200);
  if (!title) {
    const first = blocks.findIndex((node) => node.type === 'heading' && node.attrs?.level === 1);
    const heading = first === -1 ? '' : plainText(blocks[first]!).trim().slice(0, 200);
    if (heading) {
      title = heading;
      blocks = blocks.filter((_, index) => index !== first);
    }
  }
  if (!title) title = fileName.replace(/\.md$/i, '').trim().slice(0, 200) || 'Untitled';

  const locale = text(fields.locale, 2).toLowerCase();
  const rawCategories = Array.isArray(fields.categories) ? fields.categories : fields.categories === undefined ? [] : [fields.categories];
  const categoryNames = [...new Set(rawCategories.map((name) => text(name, 80)).filter(Boolean))].slice(0, 20);
  const coverSrc = text(fields.cover ?? fields.image, 4096);
  const cover = coverSrc ? describePicture(coverSrc, 'cover') : null;

  const document: EditorDocument = { type: 'doc', content: blocks };
  const seen = new Set<string>();
  const pictures: ImportPicture[] = cover ? [cover] : [];
  const collect = (node: EditorNode): void => {
    const src = node.type === 'image' ? String(node.attrs?.src ?? '') : '';
    if (src && !seen.has(src)) {
      seen.add(src);
      pictures.push(describePicture(src, 'body'));
    }
    node.content?.forEach(collect);
  };
  blocks.forEach(collect);

  return {
    title,
    slug: text(fields.slug, 160),
    locale: locale === 'th' || locale === 'en' ? locale : null,
    publishedAt,
    categoryNames,
    excerpt: text(fields.excerpt ?? fields.description, 120),
    metaTitle: text(fields.meta_title, 70) || null,
    metaDescription: text(fields.meta_description, 320) || null,
    cover,
    document,
    pictures,
    warnings,
  };
}

/**
 * The document with each matched picture in the library, each picture from another site left where
 * it is, and every other picture replaced by a line saying which is missing: a paragraph where the
 * picture stood alone, and words where it stood in a sentence.
 */
export function placePictures(document: EditorDocument, matches: ReadonlyMap<string, string>, locale: 'th' | 'en'): EditorDocument {
  const place = (node: EditorNode, inline: boolean): EditorNode => {
    if (node.type === 'image') {
      const picture = describePicture(String(node.attrs?.src ?? ''), 'body');
      const mediaId = matches.get(picture.src);
      if (mediaId) return { ...node, attrs: { ...node.attrs, src: `/media/${mediaId}`, mediaId } };
      if (picture.kind === 'remote') return node;
      const line: EditorNode = { type: 'text', text: `[${MISSING_IMAGE[locale]}: ${pictureLabel(picture)}]` };
      return inline ? line : { type: 'paragraph', content: [line] };
    }
    if (!node.content) return node;
    const holdsText = node.type === 'paragraph' || node.type === 'heading';
    return { ...node, content: node.content.map((child) => place(child, holdsText)) };
  };
  return { ...document, content: (document.content ?? []).map((node) => place(node, false)) };
}
