import { getSchema } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { DOMSerializer, Node } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { createHTMLDocument } from 'zeed-dom';
import { z } from 'zod';

import {
  editorContentInputSchema,
  MAX_DOCUMENT_BYTES,
  sanitizedContentHtmlSchema,
} from '../../lib/editor-content';
import { textAlign } from '../../lib/editor-align';
import { attachment, type AttachmentFile } from '../../lib/editor-attachment';
import { tableExtensions } from '../../lib/editor-table';
import { video, videoAttrs } from '../../lib/editor-video';
import type { EditorDocument, EditorNode } from '../../types/cms';
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

const MAX_DOCUMENT_DEPTH = 100;
const rawEditorContentInputSchema = z.object({ contentJson: z.unknown() }).strict();

const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    // No class for a quote or a code block: the sanitizer keeps none on blockquote or pre, so
    // the theme draws both. The editor's own classes match paper's, which is why they differ.
    code: { HTMLAttributes: { class: 'rounded bg-soft px-1.5 py-0.5 font-mono text-[0.9em]' } },
    // StarterKit 3 brings both. Link is configured here already, and an underline would be
    // dropped by the sanitizer on its way to the page, so neither belongs in the schema.
    link: false,
    // StarterKit 3 also appends an empty paragraph after a document that ends in anything but
    // one. A post that ends in a quote or a table would store a paragraph it never had.
    trailingNode: false,
    underline: false,
  }),
  Link.configure({
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

export interface StoredEditorContent {
  contentJson: EditorDocument;
  contentHtml: string;
}

function normalizeMediaNodes(document: EditorDocument, files: ReadonlyMap<string, AttachmentFile>): void {
  const pending: EditorNode[] = [document];
  while (pending.length) {
    const node = pending.pop();
    if (!node) break;
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

  const serialized = JSON.stringify(value);
  if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > MAX_DOCUMENT_BYTES) {
    throw new ValidationError('Content JSON is too large.');
  }
}

export function renderEditorHtml(document: EditorDocument): string {
  let html: string;
  try {
    html = documentHtml(document);
  } catch {
    throw new ValidationError('Content contains unsupported editor structure.');
  }

  const result = sanitizedContentHtmlSchema.safeParse(html);
  if (!result.success) throw new ValidationError('Rendered content is too large.');
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
