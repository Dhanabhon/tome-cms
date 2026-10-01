import { MarkdownManager } from '@tiptap/markdown';

import type { EditorDocument, EditorNode } from '../../types/cms';
import { extensions } from '../content/editor';

/**
 * A draft as Markdown, for an AI to read. Marks Markdown cannot hold (colour, underline,
 * alignment) are taken off and counted, so the AI knows a rewrite of the body would lose them.
 * Blocks it cannot hold become a line `{{tome:block N}}`, numbered in document order; markdown-in
 * puts the same block back when the line comes back.
 */
const markdown = new MarkdownManager({ extensions });

export type FormattingCounts = { color: number; underline: number; align: number };
export type BlockNote = { n: number; kind: 'video' | 'attachment' | 'table'; label: string };

/** Which kind of block cannot be Markdown, and so is stood in for. A table with a merged cell cannot. */
export function standsIn(node: EditorNode): BlockNote['kind'] | null {
  if (node.type === 'video' || node.type === 'attachment') return node.type;
  if (node.type === 'table' && /"(?:colspan|rowspan)":(?:[2-9]|\d{2,})/.test(JSON.stringify(node))) return 'table';
  return null;
}

export function documentToMarkdown(document: EditorDocument): { markdown: string; blocks: BlockNote[]; formattingNotShown: FormattingCounts } {
  const counts: FormattingCounts = { color: 0, underline: 0, align: 0 };
  const blocks: BlockNote[] = [];
  const strip = (node: EditorNode): EditorNode => {
    const kind = standsIn(node);
    if (kind) {
      blocks.push({ n: blocks.length + 1, kind, label: String(node.attrs?.title ?? node.attrs?.name ?? kind) });
      return { type: 'paragraph', content: [{ type: 'text', text: `{{tome:block ${blocks.length}}}` }] };
    }
    let attrs = node.attrs;
    if (attrs?.textAlign && attrs.textAlign !== 'left') {
      counts.align += 1;
      const { textAlign: _dropped, ...rest } = attrs;
      attrs = rest;
    }
    const marks = node.marks?.filter((mark) => {
      if (mark.type === 'textColor') { counts.color += 1; return false; }
      if (mark.type === 'underline') { counts.underline += 1; return false; }
      return true;
    });
    return {
      ...node,
      ...(attrs ? { attrs } : {}),
      ...(marks ? { marks } : {}),
      ...(node.content ? { content: node.content.map(strip) } : {}),
    };
  };
  const stripped: EditorDocument = { ...document, content: (document.content ?? []).map(strip) };
  return { markdown: markdown.serialize(stripped), blocks, formattingNotShown: counts };
}
