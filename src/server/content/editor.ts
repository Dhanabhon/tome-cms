import { getSchema, type Attributes } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { DOMSerializer, Node } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { createHTMLDocument } from 'zeed-dom';
import { z } from 'zod';

import {
  editorContentInputSchema,
  MAX_DOCUMENT_BYTES,
  sanitizedContentHtmlSchema,
} from '../../lib/editor-content';
import { withHighlightBudget } from '../../lib/code-highlight';
import { normalizeCodeLanguage } from '../../lib/code-languages';
import { textAlign } from '../../lib/editor-align';
import { codeBlock } from '../../lib/editor-code';
import { isTextColor, textColor } from '../../lib/editor-color';
import { attachment, type AttachmentFile } from '../../lib/editor-attachment';
import { linkWithFile } from '../../lib/editor-link';
import { tableExtensions } from '../../lib/editor-table';
import { video, videoAttrs } from '../../lib/editor-video';
import type { EditorDocument, EditorMark, EditorNode } from '../../types/cms';
import { isUuid } from '../media/keys';

const mediaImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      mediaId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-media-id'),
        renderHTML: () => ({}),
      },
    };
  },
});

// A link's class comes only from this extension's own config below, never from a writer's
// contentJson: without this, Link's own `class` attribute would let a link mark stamp any
// class -- including a video's `tome-video__play` -- onto an ordinary link.
const editorLink = linkWithFile.extend({
  addAttributes() {
    const { class: _class, ...attributes } = (this.parent?.() ?? {}) as Attributes;
    return attributes;
  },
});

const MAX_DOCUMENT_DEPTH = 100;
const rawEditorContentInputSchema = z.object({ contentJson: z.unknown() }).strict();

export const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    // No class for a quote: the sanitizer keeps none on blockquote, so the theme draws it. The
    // editor's own classes match paper's, which is why they differ. The code block is ours, below.
    codeBlock: false,
    code: { HTMLAttributes: { class: 'rounded bg-soft px-1.5 py-0.5 font-mono text-[0.9em]' } },
    // StarterKit 3 brings its own link; the one configured below is TomeCMS's.
    link: false,
    // StarterKit 3 also appends an empty paragraph after a document that ends in anything but
    // one. A post that ends in a quote or a table would store a paragraph it never had.
    trailingNode: false,
  }),
  codeBlock,
  editorLink.configure({
    autolink: true,
    openOnClick: false,
    HTMLAttributes: { class: 'text-link underline underline-offset-2', rel: 'noopener noreferrer' },
  }),
  mediaImage.configure({
    allowBase64: false,
    HTMLAttributes: { class: 'rounded-lg' },
  }),
  ...tableExtensions,
  textAlign,
  textColor,
  attachment,
  video,
];

const schema = getSchema(extensions);

/**
 * The stored HTML for a document: what @tiptap/html's generateHTML made, less one loss.
 *
 * ProseMirror writes a style through `style.cssText` whenever the element it built has a
 * style object, and zeed-dom's accepts the write and keeps nothing -- so an alignment showed
 * in the editor and never reached a reader. Built without that object, ProseMirror sets the
 * attribute instead, and zeed-dom keeps it.
 */
function documentHtml(document: EditorDocument): string {
  const dom = createHTMLDocument();
  const createElement = dom.createElement.bind(dom);
  dom.createElement = ((name: string) => Object.defineProperty(createElement(name), 'style', { value: undefined })) as typeof dom.createElement;
  const fragment = DOMSerializer.fromSchema(schema).serializeFragment(Node.fromJSON(schema, document).content, {
    document: dom as unknown as Document,
  });
  return (fragment as unknown as { render(): string }).render();
}

export class ValidationError extends Error {
  override name = 'ValidationError';
}

/** A document, or its page, too long to store. */
export class ContentTooLargeError extends ValidationError {}

const bytes = (value: string) => new TextEncoder().encode(value).byteLength;

/**
 * The bytes of a JSON value as Postgres prints it as jsonb, which is what the content tables'
 * checks measure: a space after each key's colon and after each comma, strings escaped as JSON does.
 * That is a tenth more than JSON.stringify on a document of many small nodes. Postgres orders the
 * keys its own way, which does not change the length; numbers are as JSON writes them, which is
 * Postgres's form for any number without an exponent.
 */
export function jsonbTextLength(value: unknown): number {
  if (Array.isArray(value)) return 2 + value.reduce<number>((sum, item, index) => sum + (index ? 2 : 0) + jsonbTextLength(item), 0);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    return 2 + entries.reduce((sum, [key, item], index) => sum + (index ? 2 : 0) + bytes(JSON.stringify(key)) + 2 + jsonbTextLength(item), 0);
  }
  return bytes(JSON.stringify(value));
}

export interface StoredEditorContent {
  contentJson: EditorDocument;
  contentHtml: string;
}

/**
 * A link holds a file only while it is that file's address. Typing a URL over one leaves the old
 * mediaId beside the new href, since the editor merges attributes; that link is an ordinary link
 * now, and saves as one. An id that is no id is not that, and is refused.
 */
function normalizeLinkedFile(mark: EditorMark): void {
  const attrs = mark.attrs;
  if (attrs?.mediaId === undefined || attrs.mediaId === null) return;
  const mediaId = typeof attrs.mediaId === 'string' ? attrs.mediaId.toLowerCase() : '';
  if (!isUuid(mediaId)) throw new ValidationError('A link to a file must name a file from this site.');
  const { mediaId: _held, ...rest } = attrs;
  mark.attrs = typeof attrs.href === 'string' && attrs.href.toLowerCase() === `/media/${mediaId}`
    ? { ...rest, href: `/media/${mediaId}`, mediaId }
    : rest;
}

function normalizeMediaNodes(document: EditorDocument, files: ReadonlyMap<string, AttachmentFile>): void {
  const pending: EditorNode[] = [document];
  while (pending.length) {
    const node = pending.pop();
    if (!node) break;
    // A colour outside the palette is dropped, from the document as well as the page.
    if (node.marks) {
      for (const mark of node.marks) if (mark.type === 'link') normalizeLinkedFile(mark);
      const marks = node.marks.filter((mark) => mark.type !== 'textColor' || isTextColor(mark.attrs?.color));
      if (marks.length) node.marks = marks;
      else delete node.marks;
    }
    // A language is None, Auto or one of the list's: a writer's own string never reaches the page.
    if (node.type === 'codeBlock') node.attrs = { ...node.attrs, language: normalizeCodeLanguage(node.attrs?.language) };
    if (node.type === 'image') {
      const attrs = node.attrs ?? {};
      const src = attrs.src;
      if (typeof src !== 'string') throw new ValidationError('Images require a valid source.');
      const stable = /^\/media\/([^/?#]+)$/.exec(src);
      if (stable && isUuid(stable[1] ?? '')) {
        const mediaId = stable[1]!.toLowerCase();
        if (attrs.mediaId !== undefined && attrs.mediaId !== null && attrs.mediaId !== mediaId) {
          throw new ValidationError('Image identity does not match its source.');
        }
        node.attrs = { ...attrs, mediaId, src: `/media/${mediaId}` };
      } else {
        let legacy: URL;
        try {
          legacy = new URL(src);
        } catch {
          throw new ValidationError('Images require a valid source.');
        }
        if ((legacy.protocol !== 'http:' && legacy.protocol !== 'https:') || (attrs.mediaId !== undefined && attrs.mediaId !== null)) {
          throw new ValidationError('Images require a valid source.');
        }
      }
    }
    if (node.type === 'attachment') {
      const mediaId = typeof node.attrs?.mediaId === 'string' ? node.attrs.mediaId.toLowerCase() : '';
      const file = files.get(mediaId);
      if (!file) throw new ValidationError('Attachments require a file from this site.');
      // The library's word, not the editor's: the card is stored, and says what its file is.
      node.attrs = { href: `/media/${mediaId}`, mediaId, mimeType: file.mimeType, name: file.name, size: file.size };
    }
    if (node.type === 'video') {
      const attrs = videoAttrs(node.attrs);
      if (!attrs) throw new ValidationError('Videos require one YouTube or Vimeo clip.');
      // Only what a video is: a writer's extra attributes never reach the page.
      node.attrs = { ...attrs };
    }
    pending.push(...(node.content ?? []));
  }
}

export function editorMediaIds(document: EditorDocument): string[] {
  const ids = new Set<string>();
  const pending: EditorNode[] = [document];
  while (pending.length) {
    const node = pending.pop();
    if (!node) break;
    if ((node.type === 'image' || node.type === 'video') && typeof node.attrs?.mediaId === 'string') ids.add(node.attrs.mediaId);
    pending.push(...(node.content ?? []));
  }
  return [...ids];
}

/** The documents a document's cards point at, as ids a lookup can take. */
export function editorFileIds(document: EditorDocument): string[] {
  const ids = new Set<string>();
  const pending: EditorNode[] = [document];
  while (pending.length) {
    const node = pending.pop();
    if (!node) break;
    const mediaId = node.attrs?.mediaId;
    if (node.type === 'attachment' && typeof mediaId === 'string' && isUuid(mediaId)) ids.add(mediaId.toLowerCase());
    pending.push(...(node.content ?? []));
  }
  return [...ids];
}

function assertJsonBounds(value: unknown): void {
  const pending: Array<{ depth: number; value: unknown }> = [{ depth: 0, value }];
  const seen = new WeakSet<object>();

  while (pending.length) {
    const current = pending.pop();
    if (!current) break;
    if (current.depth > MAX_DOCUMENT_DEPTH) throw new ValidationError('Content is nested too deeply.');

    const type = typeof current.value;
    if (current.value === null || type === 'string' || type === 'boolean') continue;
    if (type === 'number') {
      if (!Number.isFinite(current.value)) throw new ValidationError('Content contains an invalid number.');
      continue;
    }
    if (type !== 'object') throw new ValidationError('Content must contain JSON values only.');

    const object = current.value as object;
    const prototype = Object.getPrototypeOf(object);
    if (!Array.isArray(object) && prototype !== Object.prototype && prototype !== null) {
      throw new ValidationError('Content must contain JSON values only.');
    }
    if (seen.has(object)) throw new ValidationError('Content must not contain circular values.');
    seen.add(object);
    for (const child of Object.values(object)) {
      pending.push({ depth: current.depth + 1, value: child });
    }
  }

  if (jsonbTextLength(value) > MAX_DOCUMENT_BYTES) throw new ContentTooLargeError('Content JSON is too large.');
}

export function renderEditorHtml(document: EditorDocument): string {
  let html: string;
  try {
    html = withHighlightBudget(() => documentHtml(document));
  } catch {
    throw new ValidationError('Content contains unsupported editor structure.');
  }

  const result = sanitizedContentHtmlSchema.safeParse(html);
  if (!result.success) throw new ContentTooLargeError('Rendered content is too large.');
  return result.data;
}

/** The bounds and the shape of a document sent by an editor, before anything is looked up. */
export function parseEditorContent(input: unknown): EditorDocument {
  const raw = rawEditorContentInputSchema.parse(input);
  assertJsonBounds(raw.contentJson);
  return editorContentInputSchema.parse(input).contentJson;
}

/** A parsed document made safe to store: its media named by id, its cards filled from `files`. */
export function renderEditorContent(contentJson: EditorDocument, files: ReadonlyMap<string, AttachmentFile> = new Map()): StoredEditorContent {
  normalizeMediaNodes(contentJson, files);
  return { contentJson, contentHtml: renderEditorHtml(contentJson) };
}

export function prepareEditorContent(input: unknown, files: ReadonlyMap<string, AttachmentFile> = new Map()): StoredEditorContent {
  return renderEditorContent(parseEditorContent(input), files);
}
