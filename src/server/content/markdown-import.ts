import { MarkdownManager } from '@tiptap/markdown';
import type { Token } from 'marked';
import { parse as parseYaml } from 'yaml';

import { normalizeCodeLanguage } from '../../lib/code-languages';
import { MAX_DOCUMENT_BYTES } from '../../lib/editor-content';
import {
  describePicture,
  MISSING_IMAGE,
  pictureLabel,
  type ImportLimit,
  type ImportPicture,
  type ImportWarning,
} from '../../lib/markdown-import';
import type { EditorDocument, EditorNode } from '../../types/cms';
import { extensions, renderEditorHtml, ValidationError } from './editor';

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
 * block re-reads the rest of the file, and the marks in one paragraph cost more than linear in
 * their number, so a 900 KB file of tiny blocks or marks takes minutes and stops the whole site.
 * The file is first cut into blocks by a plain Markdown lexer, which is fast because it leaves
 * the marks inside blocks alone; the blocks are counted, and so are the marks in each. Reading
 * the file as the parser does (rather than guessing where its code blocks are) means a file
 * cannot hide its marks from the count. A file over a limit is refused. A long post (100,000
 * words, 500 pictures, long listings) uses a fraction of each.
 */
export const MAX_FRONTMATTER = 20_000;
/** Blocks, nested ones too; each makes the parser read the rest of its part of the file again. */
export const MAX_BLOCKS = 4_000;
/** The same, per line: hard-wrapped text and listings are long but are few blocks. */
export const MAX_LINES = 25_000;
/** Lines in one paragraph, quote or list item: lines after the first are read again for each one. */
export const MAX_BLOCK_LINES = 2_000;
/** Link definitions, which the lexer takes out of the text and so counts as no block. */
export const MAX_DEFINITIONS = 2_000;
/** Characters that start a mark in text: emphasis, code, a link or tag, an escape, a bare address. */
export const MAX_INLINE = 40_000;
/** Marks in one paragraph, heading or cell: the lexer's cost grows with their square. */
export const MAX_INLINE_IN_BLOCK = 5_000;
/** Emphasis marks in one of them: the dearest kind (1,500 cost a tenth of a second). */
export const MAX_EMPHASIS = 1_500;
export const MAX_PICTURES = 2_000;
/** Levels of lists, quotes and tables inside each other; the server's own check stops a little past this. */
export const MAX_DEPTH = 40;
/** Different tags a file may hold; they are searched for together, in every text that has a `<`. */
export const MAX_HTML = 300;

/** What a post stores, the document and its page, is capped at MAX_DOCUMENT_BYTES each; this much of it is used. */
const FITS_BYTES = Math.floor(MAX_DOCUMENT_BYTES * 0.9);

const INLINE_START = /[<[*_`~\\]|https?:|www\./gi;
const EMPHASIS = /[*_~]/g;
const PICTURE_START = /!\[/g;
const DEFINITION = /^ {0,3}\[[^\]\n]+\]:/gm;

const bytes = (value: string) => new TextEncoder().encode(value).byteLength;

/**
 * The bytes of a JSON value as Postgres prints it as jsonb, which is what the posts table's check
 * measures: a space after each key's colon and after each comma, strings escaped as JSON does.
 * Postgres orders the keys its own way, which does not change the length; numbers are as JSON writes
 * them, which is Postgres's form for any number without an exponent (the parser makes small whole ones).
 */
export function jsonbTextLength(value: unknown): number {
  if (Array.isArray(value)) return 2 + value.reduce<number>((sum, item, index) => sum + (index ? 2 : 0) + jsonbTextLength(item), 0);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    return 2 + entries.reduce((sum, [key, item], index) => sum + (index ? 2 : 0) + bytes(JSON.stringify(key)) + 2 + jsonbTextLength(item), 0);
  }
  return bytes(JSON.stringify(value));
}

/**
 * A post stores its document and its rendered page, each capped at a million bytes, and both are
 * much larger than the Markdown (prose is about twice as large as JSON; a listing is several times
 * as large as HTML). A file whose post would not fit is refused here, at the preview, and not by
 * the database after the pictures are uploaded. The rest of the cap is room for the pictures'
 * addresses, which are longer once they are in the library.
 */
function assertFits(document: EditorDocument): void {
  if (jsonbTextLength(document) > FITS_BYTES) throw new MarkdownTooComplexError('size');
  let html: string;
  try {
    html = renderEditorHtml(document);
  } catch (error) {
    if (error instanceof ValidationError && error.message === 'Rendered content is too large.') throw new MarkdownTooComplexError('size');
    throw error;
  }
  if (bytes(html) > FITS_BYTES) throw new MarkdownTooComplexError('size');
}

/** What the worker sends back: the post, or why there is none. */
export type ParseReply =
  | { kind: 'parsed'; post: ParsedMarkdownPost }
  | { kind: 'too-complex'; limit: ImportLimit }
  | { kind: 'invalid'; message: string };

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

/** The text of every block that holds marks (code and HTML blocks hold none), at any depth. */
function* markedText(tokens: readonly Token[]): Generator<string> {
  for (const token of tokens) {
    if (token.type === 'paragraph' || token.type === 'heading' || token.type === 'text') yield token.text;
    else if (token.type === 'table') for (const cell of [...token.header, ...token.rows.flat()]) yield cell.text;
    else if (token.type === 'blockquote') yield* markedText(token.tokens ?? []);
    else if (token.type === 'list') for (const item of token.items) yield* markedText(item.tokens);
  }
}

const lineCount = (value: string): number => count(value, /\n/g);

/** Blocks at any depth. A tight list's item text is not one: it costs no more than the item. */
function countBlocks(tokens: readonly Token[]): number {
  let blocks = 0;
  for (const token of tokens) {
    if (token.type === 'space' || token.type === 'text') continue;
    blocks += 1;
    if (token.type === 'blockquote') blocks += countBlocks(token.tokens ?? []);
    else if (token.type === 'list') for (const item of token.items) blocks += countBlocks(item.tokens);
  }
  return blocks;
}

/** The longest run of lines in one paragraph, quote or list item; code, tables and HTML are read once. */
function longestBlock(tokens: readonly Token[]): number {
  let longest = 0;
  for (const token of tokens) {
    if (token.type === 'list') for (const item of token.items) longest = Math.max(longest, lineCount(item.raw));
    else if (token.type === 'blockquote' || token.type === 'paragraph') longest = Math.max(longest, lineCount(token.raw));
  }
  return longest;
}

function checkSize(body: string): void {
  if (lineCount(body) > MAX_LINES) throw new MarkdownTooComplexError('lines');
  if (count(body, DEFINITION) > MAX_DEFINITIONS) throw new MarkdownTooComplexError('definitions');
  const tokens = new markdown.instance.Lexer(markdown.instance.getDefaults()).blockTokens(body);
  if (longestBlock(tokens) > MAX_BLOCK_LINES) throw new MarkdownTooComplexError('block-lines');
  if (countBlocks(tokens) > MAX_BLOCKS) throw new MarkdownTooComplexError('blocks');
  let inline = 0;
  let pictures = 0;
  for (const value of markedText(tokens)) {
    if (count(value, EMPHASIS) > MAX_EMPHASIS) throw new MarkdownTooComplexError('emphasis');
    const marks = count(value, INLINE_START);
    if (marks > MAX_INLINE_IN_BLOCK) throw new MarkdownTooComplexError('inline');
    inline += marks;
    pictures += count(value, PICTURE_START);
  }
  if (pictures > MAX_PICTURES) throw new MarkdownTooComplexError('pictures');
  if (inline > MAX_INLINE) throw new MarkdownTooComplexError('inline');
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

function clean(node: EditorNode, html: RegExp | null, counts: { links: number }, inCode: boolean): EditorNode | null {
  if (node.type === 'text') {
    const isCode = inCode || Boolean(node.marks?.some((mark) => mark.type === 'code'));
    let value = node.text ?? '';
    if (html && !isCode && value.includes('<')) value = value.replace(html, '');
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

  const counts = { links: 0 };
  let blocks: EditorNode[];
  let htmlCount: number;
  try {
    checkSize(body);
    const found = htmlTokens(body);
    htmlCount = found.length;
    const distinct = [...new Set(found)].sort((left, right) => right.length - left.length);
    if (distinct.length > MAX_HTML) throw new MarkdownTooComplexError('html');
    // One pass over each text, the longest tag first, rather than one search for each tag.
    const html = distinct.length ? new RegExp(distinct.map((raw) => raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g') : null;
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
  assertFits(document);
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
