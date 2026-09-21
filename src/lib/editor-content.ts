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
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    code: ['class'],
    h1: ['style'],
    h2: ['style'],
    h3: ['style'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    p: ['style'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
  },
  // A table's wrapper is the only thing that may carry a class of its own: it is how a wide
  // table scrolls inside its box on a phone.
  allowedClasses: { div: ['tableWrapper'] },
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

const BLOCKS = new Set(['blockquote', 'bulletList', 'doc', 'listItem', 'orderedList', 'table', 'tableCell', 'tableHeader', 'tableRow']);

export function editorText(node: EditorNode): string {
  if (typeof node.text === 'string') return node.text;
  return (node.content ?? []).map(editorText).join(BLOCKS.has(node.type ?? '') ? ' ' : '');
}

export function hasMeaningfulContent(node: EditorNode): boolean {
  if (node.type === 'image') return true;
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
