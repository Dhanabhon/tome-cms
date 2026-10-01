import type { EditorDocument, EditorNode } from '../../types/cms';
import { readMarkdownPost } from '../content/markdown-import-run';
import { isUuid } from '../media/keys';
import { standsIn } from './markdown-out';

/** Said to the AI as the tool's error, so it can fix the call and try again. */
export class McpInputError extends Error {
  override name = 'McpInputError';
}

const BLOCK_LINE = /^\{\{tome:block (\d+)\}\}$/;
const LIBRARY = /^\/media\/([^/?#]+)$/;

/** The source draft's stood-in blocks, numbered as documentToMarkdown numbered them. */
function sourceBlocks(source: EditorDocument | null): EditorNode[] {
  const found: EditorNode[] = [];
  const walk = (node: EditorNode): void => {
    if (standsIn(node)) found.push(node);
    else node.content?.forEach(walk);
  };
  source?.content?.forEach(walk);
  return found;
}

/**
 * Markdown from an AI as a draft's document. A leading `---` is a rule here, not frontmatter, and
 * a first `# heading` stays in the body: the reader gets a title line ahead of the text so it
 * takes neither.
 */
export async function markdownToDocument(text: string, source: EditorDocument | null): Promise<{ document: EditorDocument; warnings: string[] }> {
  const parsed = await readMarkdownPost(`---\ntitle: draft\n---\n${text.replace(/\r\n?/g, '\n')}`, 'draft.md');
  const blocks = sourceBlocks(source);
  const outside: string[] = [];
  const place = (node: EditorNode): EditorNode => {
    const only = node.type === 'paragraph' && node.content?.length === 1 ? node.content[0] : undefined;
    const line = only?.type === 'text' ? BLOCK_LINE.exec(only.text?.trim() ?? '') : null;
    if (line) {
      if (!source) throw new McpInputError('A new draft has no blocks to put back: remove the {{tome:block N}} lines.');
      const block = blocks[Number(line[1]) - 1];
      if (!block) throw new McpInputError(`There is no block ${line[1]} in this draft; it has ${blocks.length}. Read it again to see its blocks.`);
      return block;
    }
    if (node.type === 'image') {
      const src = String(node.attrs?.src ?? '');
      const id = LIBRARY.exec(src)?.[1];
      if (!id || !isUuid(id)) {
        outside.push(src);
        return node;
      }
      return { ...node, attrs: { ...node.attrs, mediaId: id.toLowerCase(), src: `/media/${id.toLowerCase()}` } };
    }
    return node.content ? { ...node, content: node.content.map(place) } : node;
  };
  const document: EditorDocument = { type: 'doc', content: (parsed.document.content ?? []).map(place) };
  if (outside.length) {
    throw new McpInputError(`Pictures must come from this site's library: ${outside.slice(0, 5).join(', ')}. Find one with list_media and use its /media/<id> address.`);
  }
  const warnings = parsed.warnings.flatMap((warning) => {
    if (warning.code === 'html-removed') return [`HTML was removed (${warning.count}).`];
    if (warning.code === 'links-removed') return [`Links that were not web addresses were removed, their words kept (${warning.count}).`];
    if (warning.code === 'task-list') return ['Checkboxes in a task list became an ordinary list.'];
    return [];
  });
  return { document, warnings };
}
