import { getSchema } from '@tiptap/core';
import { Node } from '@tiptap/pm/model';

import type { EditorDocument, EditorNode } from '../../types/cms';
import { extensions } from '../content/editor';
import { readMarkdownPost } from '../content/markdown-import-run';
import { isUuid } from '../media/keys';
import { standsIn } from './markdown-out';

/** Said to the AI as the tool's error, so it can fix the call and try again. */
export class McpInputError extends Error {
  override name = 'McpInputError';
}

const BLOCK_LINE = /^\{\{tome:block (\d+)\}\}$/;
const LIBRARY = /^\/media\/([^/?#]+)$/;
// The editor's own schema: a block put back where the editor cannot hold it, such as a video in a
// list item, is refused here rather than stored as a draft the editor cannot open.
const schema = getSchema(extensions);

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

/** Words with the spaces, line ends and breaks taken off both ends. */
function trimEdges(run: EditorNode[]): EditorNode[] {
  const nodes = [...run];
  // True when the end node went altogether, so the next one in is trimmed too.
  // trimStart and trimEnd take the same whitespace as \s, in linear time: /\s+$/ backtracks
  // quadratically over a long run of spaces followed by a word, on the main thread.
  const trim = (index: number, cut: (text: string) => string): boolean => {
    const node = nodes[index];
    if (node?.type === 'hardBreak') {
      nodes.splice(index, 1);
      return true;
    }
    if (node?.type !== 'text') return false;
    const text = cut(node.text ?? '');
    if (text) nodes[index] = { ...node, text };
    else nodes.splice(index, 1);
    return !text;
  };
  while (nodes.length && trim(0, (text) => text.trimStart())) { /* trimmed */ }
  while (nodes.length && trim(nodes.length - 1, (text) => text.trimEnd())) { /* trimmed */ }
  return nodes;
}

/**
 * The editor holds a picture only as a block, but Markdown reads one on the line under some words
 * as part of their paragraph. That is how a list item with words, a picture and more words is
 * written out, so the paragraph is split around each picture rather than refused.
 */
function liftPictures(node: EditorNode): EditorNode[] {
  if (node.type !== 'paragraph' || !node.content?.some((child) => child.type === 'image')) return [node];
  const lifted: EditorNode[] = [];
  let words: EditorNode[] = [];
  const close = (): void => {
    const kept = trimEdges(words);
    if (kept.length) lifted.push({ ...node, content: kept });
    words = [];
  };
  for (const child of node.content) {
    if (child.type !== 'image') {
      words.push(child);
      continue;
    }
    close();
    lifted.push(child);
  }
  close();
  return lifted;
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
    return node.content ? { ...node, content: node.content.flatMap((child) => liftPictures(place(child))) } : node;
  };
  const document: EditorDocument = { type: 'doc', content: (parsed.document.content ?? []).flatMap((node) => liftPictures(place(node))) };
  if (outside.length) {
    throw new McpInputError(`Pictures must come from this site's library: ${outside.slice(0, 5).join(', ')}. Find one with list_media and use its /media/<id> address.`);
  }
  try {
    Node.fromJSON(schema, document).check();
  } catch {
    throw new McpInputError('Keep each {{tome:block N}} line on a line of its own, outside lists and quotes, and try again.');
  }
  const warnings = parsed.warnings.flatMap((warning) => {
    if (warning.code === 'html-removed') return [`HTML was removed (${warning.count}).`];
    if (warning.code === 'links-removed') return [`Links that were not web addresses were removed, their words kept (${warning.count}).`];
    if (warning.code === 'task-list') return ['Checkboxes in a task list became an ordinary list.'];
    return [];
  });
  return { document, warnings };
}
