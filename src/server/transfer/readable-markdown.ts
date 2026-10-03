import { MarkdownManager } from '@tiptap/markdown';

import { VIDEO_PROVIDER_NAMES, videoWatchUrl, type VideoProvider } from '../../lib/video-link';
import type { EditorDocument, EditorMark, EditorNode } from '../../types/cms';
import { extensions } from '../content/editor';
import { standsIn } from '../mcp/markdown-out';

/**
 * A post or page as Markdown for a person to read, beside the exact `.tome.json` an import uses.
 * Unlike what MCP reads, nothing here comes back: a block Markdown cannot hold becomes a plain
 * link or a line naming where it is, and each library file is linked by its path in the archive.
 */
const markdown = new MarkdownManager({ extensions });

const TABLE_NOTE = 'Table: see the .tome.json file.';

const paragraph = (text: string, href?: string): EditorNode => ({
  type: 'paragraph',
  content: [{ type: 'text', text, ...(href ? { marks: [{ type: 'link', attrs: { href } }] } : {}) }],
});

export function documentToReadableMarkdown(
  document: EditorDocument,
  link: (mediaId: string) => string | null,
): { markdown: string; formattingNotShown: number } {
  let formattingNotShown = 0;
  const fileHref = (attrs: EditorNode['attrs'], fallback: unknown): string | undefined => {
    const linked = typeof attrs?.mediaId === 'string' ? link(attrs.mediaId) : null;
    return linked ?? (typeof fallback === 'string' ? fallback : undefined);
  };
  const keepMark = (mark: EditorMark): boolean => {
    if (mark.type !== 'textColor' && mark.type !== 'underline') return true;
    formattingNotShown += 1;
    return false;
  };
  const relinkMark = (mark: EditorMark): EditorMark => {
    if (mark.type !== 'link' || typeof mark.attrs?.mediaId !== 'string') return mark;
    return { ...mark, attrs: { ...mark.attrs, href: fileHref(mark.attrs, mark.attrs.href) ?? null } };
  };
  const readable = (node: EditorNode): EditorNode => {
    const attrs = node.attrs ?? {};
    switch (standsIn(node)) {
      case 'video': {
        const provider = attrs.provider as VideoProvider;
        const start = typeof attrs.start === 'number' ? attrs.start : null;
        const title = typeof attrs.title === 'string' && attrs.title ? attrs.title : VIDEO_PROVIDER_NAMES[provider];
        return paragraph(title, videoWatchUrl({ provider, start, videoId: String(attrs.videoId) }));
      }
      case 'attachment': return paragraph(String(attrs.name || 'File'), fileHref(attrs, attrs.href));
      case 'table': return paragraph(TABLE_NOTE);
      case null: break;
    }
    let next = node;
    if (node.type === 'image') next = { ...next, attrs: { ...attrs, src: fileHref(attrs, attrs.src) ?? null } };
    if (attrs.textAlign && attrs.textAlign !== 'left') {
      formattingNotShown += 1;
      const { textAlign: _dropped, ...rest } = attrs;
      next = { ...next, attrs: rest };
    }
    if (node.marks) next = { ...next, marks: node.marks.filter(keepMark).map(relinkMark) };
    if (node.content) next = { ...next, content: node.content.map(readable) };
    return next;
  };
  const shown: EditorDocument = { ...document, content: (document.content ?? []).map(readable) };
  return { markdown: markdown.serialize(shown), formattingNotShown };
}
