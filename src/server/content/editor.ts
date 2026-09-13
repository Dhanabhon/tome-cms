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
import type { EditorDocument } from '../../types/cms';

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
  Image.configure({
    allowBase64: false,
    HTMLAttributes: { class: 'rounded-lg' },
  }),
];

export class ValidationError extends Error {
  override name = 'ValidationError';
}

export interface StoredEditorContent {
  contentJson: EditorDocument;
  contentHtml: string;
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
  return { contentJson, contentHtml: renderEditorHtml(contentJson) };
}
