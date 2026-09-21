import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { generateHTML } from '@tiptap/html';
import StarterKit from '@tiptap/starter-kit';
import { z } from 'zod';

import {
  editorContentInputSchema,
  MAX_DOCUMENT_BYTES,
  sanitizedContentHtmlSchema,
} from '../../lib/editor-content';
import { tableExtensions } from '../../lib/editor-table';
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
    blockquote: { HTMLAttributes: { class: 'border-l-2 border-accent pl-5 italic' } },
    code: { HTMLAttributes: { class: 'rounded bg-soft px-1.5 py-0.5 font-mono text-[0.9em]' } },
    codeBlock: { HTMLAttributes: { class: 'rounded-lg bg-ink p-5 font-mono text-sm text-white' } },
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
];

export class ValidationError extends Error {
  override name = 'ValidationError';
}

export interface StoredEditorContent {
  contentJson: EditorDocument;
  contentHtml: string;
}

function normalizeMediaNodes(document: EditorDocument): void {
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
    pending.push(...(node.content ?? []));
  }
}

export function editorMediaIds(document: EditorDocument): string[] {
  const ids = new Set<string>();
  const pending: EditorNode[] = [document];
  while (pending.length) {
    const node = pending.pop();
    if (!node) break;
    if (node.type === 'image' && typeof node.attrs?.mediaId === 'string') ids.add(node.attrs.mediaId);
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
    html = generateHTML(document, extensions);
  } catch {
    throw new ValidationError('Content contains unsupported editor structure.');
  }

  const result = sanitizedContentHtmlSchema.safeParse(html);
  if (!result.success) throw new ValidationError('Rendered content is too large.');
  return result.data;
}

export function prepareEditorContent(input: unknown): StoredEditorContent {
  const raw = rawEditorContentInputSchema.parse(input);
  assertJsonBounds(raw.contentJson);
  const { contentJson } = editorContentInputSchema.parse(input);
  normalizeMediaNodes(contentJson);
  return { contentJson, contentHtml: renderEditorHtml(contentJson) };
}
