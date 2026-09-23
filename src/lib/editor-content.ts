import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';

import type { EditorDocument, EditorNode, Json } from '../types/cms';

export const MAX_DOCUMENT_BYTES = 1_000_000;

const httpUrl = z.url({ protocol: /^https?$/, error: 'Use an HTTP or HTTPS URL.' });
// readJson validates JSON values and nesting before these structural schemas run.
const editorAttrsSchema = z.record(z.string(), z.custom<Json>()).optional();
const editorNodeSchema = (depth = 0): z.ZodType<EditorNode> => z.object({
  type: z.string().min(1),
  attrs: editorAttrsSchema,
  // ponytail: cap nesting at 100 to bound validation/traversal; raise only if the editor needs deeper documents.
  content: z.array(depth < 100 ? z.lazy(() => editorNodeSchema(depth + 1)) : z.never()).optional(),
  marks: z.array(z.object({ type: z.string().min(1), attrs: editorAttrsSchema })).optional(),
  text: z.string().optional(),
});

export const editorDocumentSchema: z.ZodType<EditorDocument> = z.object({
  type: z.literal('doc'),
  content: z.array(editorNodeSchema()).optional(),
});

export const editorContentInputSchema = z.object({
  contentJson: editorDocumentSchema,
}).strict();

const sanitizeOptions: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'h1',
    'h2',
    'h3',
    'ul',
    'ol',
    'li',
    'blockquote',
    'pre',
    'code',
    'strong',
    'em',
    's',
    'a',
    'img',
    'hr',
    'div',
    'table',
    'tbody',
    'tr',
    'th',
    'td',
    'span',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel', 'type'],
    code: ['class'],
    h1: ['style'],
    h2: ['style'],
    h3: ['style'],
    // The transform below gives every image these two. sanitize-html filters after it transforms,
    // so they are allowed here as well, with no value but the one the transform writes.
    img: ['src', 'alt', 'title', 'width', 'height', { name: 'decoding', values: ['async'] }, { name: 'loading', values: ['lazy'] }],
    p: ['style'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
  },
  // A table's wrapper and a file card's parts are the only things that carry a class: the
  // wrapper is how a wide table scrolls inside its box on a phone, and the card is drawn by it.
  allowedClasses: { div: ['tableWrapper'], p: ['file-card'], span: ['file-card__name', 'file-card__meta'] },
  // Alignment is the one style a writer can set, and only to these three values.
  allowedStyles: { '*': { 'text-align': [/^(left|center|right)$/] } },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }, true),
    img: sanitizeHtml.simpleTransform('img', { decoding: 'async', loading: 'lazy' }, true),
  },
};

export const sanitizedContentHtmlSchema: z.ZodType<string> = z
  .string()
  .max(MAX_DOCUMENT_BYTES)
  .transform((html) => sanitizeHtml(html, sanitizeOptions))
  .pipe(z.string().max(MAX_DOCUMENT_BYTES));

/**
 * An article that opens with a picture, with no cover drawn above it: that picture is what the
 * reader's screen is waiting on, so it is fetched first rather than lazily. Only an opening
 * picture qualifies. One further down loads as the reader nears it, and raising a guess would
 * take bandwidth from what the screen actually needs. Themes call this, never the API: a
 * headless site knows its own layout.
 */
export function withLeadImage(html: string): string {
  return html.replace(/^<img\b[^>]*>/, (tag) => tag
    .replace(/\sloading="[^"]*"/, '')
    .replace(/^<img\b/, '<img fetchpriority="high"'));
}

const BLOCKS = new Set(['blockquote', 'bulletList', 'doc', 'listItem', 'orderedList', 'table', 'tableCell', 'tableHeader', 'tableRow']);

export function editorText(node: EditorNode): string {
  if (typeof node.text === 'string') return node.text;
  return (node.content ?? []).map(editorText).join(BLOCKS.has(node.type ?? '') ? ' ' : '');
}

export function hasMeaningfulContent(node: EditorNode): boolean {
  if (node.type === 'image' || node.type === 'attachment') return true;
  if (typeof node.text === 'string' && node.text.trim()) return true;
  return (node.content ?? []).some(hasMeaningfulContent);
}

export function hasMeaningfulHtml(html: string): boolean {
  let meaningful = false;
  const imageBase = 'https://tomecms.invalid';
  // The wrapper also collects plain text outside block elements; frame.text has decoded entities.
  sanitizeHtml(`<div>${html}</div>`, {
    allowedTags: ['div', 'img'],
    allowedAttributes: { img: ['src'] },
    exclusiveFilter: ({ tag, text, attribs }) => {
      if (/[^\s\p{Default_Ignorable_Code_Point}]/u.test(text)) meaningful = true;
      if (tag === 'img' && attribs.src?.trim() && URL.canParse(attribs.src, imageBase)) {
        meaningful ||= httpUrl.safeParse(new URL(attribs.src, imageBase).href).success;
      }
      return false;
    },
  });
  return meaningful;
}
