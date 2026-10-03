import assert from 'node:assert/strict';
import test from 'node:test';

import { documentToMarkdown } from '../../src/server/mcp/markdown-out';
import { documentToReadableMarkdown } from '../../src/server/transfer/readable-markdown';
import type { EditorDocument, EditorNode, Json } from '../../src/types/cms';

const PICTURE = '55555555-5555-4555-8555-555555555555';
const GUIDE = '66666666-6666-4666-8666-666666666666';
const POSTER = '77777777-7777-4777-8777-777777777777';
const links: Record<string, string> = {
  [PICTURE]: '../../media/owners/o/2026/10/p.webp',
  [GUIDE]: '../../media/owners/o/2026/10/g.pdf',
};
const link = (mediaId: string) => links[mediaId] ?? null;
const doc = (...content: EditorNode[]) => ({ type: 'doc', content }) as EditorDocument;
const p = (text: string, marks?: EditorNode['marks'], attrs?: Record<string, Json>): EditorNode =>
  ({ type: 'paragraph', ...(attrs ? { attrs } : {}), content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] });
const cell = (text: string, attrs: Record<string, Json> = { colspan: 1, rowspan: 1 }): EditorNode =>
  ({ type: 'tableCell', attrs, content: [p(text)] });

test('a picture from the library links to its file in media/', () => {
  const out = documentToReadableMarkdown(doc({ type: 'image', attrs: { src: `/media/${PICTURE}`, alt: 'รูปขนม', mediaId: PICTURE } }), link);
  assert.equal(out.markdown, '![รูปขนม](../../media/owners/o/2026/10/p.webp)');
  assert.equal(out.formattingNotShown, 0);
});

test('a picture from elsewhere keeps its address', () => {
  const out = documentToReadableMarkdown(doc({ type: 'image', attrs: { src: 'https://example.com/a.jpg', alt: 'a' } }), link);
  assert.equal(out.markdown, '![a](https://example.com/a.jpg)');
});

test('a video becomes a link to the clip, named by its title or else its provider', () => {
  const titled = { type: 'video', attrs: { provider: 'youtube', videoId: 'dQw4w9WgXcQ', start: 42, title: 'คลิป', mediaId: POSTER } };
  assert.equal(documentToReadableMarkdown(doc(titled), link).markdown, '[คลิป](https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42)');
  const untitled = { type: 'video', attrs: { provider: 'vimeo', videoId: '76979871', start: null, title: '', mediaId: null } };
  assert.equal(documentToReadableMarkdown(doc(untitled), link).markdown, '[Vimeo](https://vimeo.com/76979871)');
});

test('an attachment becomes a link to its file, named by the file', () => {
  const card = { type: 'attachment', attrs: { href: `/media/${GUIDE}`, mediaId: GUIDE, mimeType: 'application/pdf', name: 'คู่มือ.pdf', size: 1024 } };
  assert.equal(documentToReadableMarkdown(doc(card), link).markdown, '[คู่มือ.pdf](../../media/owners/o/2026/10/g.pdf)');
});

test('a link to a file in the library goes to its file in media/, and any other link stays', () => {
  const out = documentToReadableMarkdown(doc(
    p('the guide', [{ type: 'link', attrs: { href: `/media/${GUIDE}`, mediaId: GUIDE } }]),
    p('elsewhere', [{ type: 'link', attrs: { href: 'https://example.com/' } }]),
  ), link);
  assert.equal(out.markdown, '[the guide](../../media/owners/o/2026/10/g.pdf)\n\n[elsewhere](https://example.com/)');
});

test('a table with a merged cell becomes a line pointing at the exact copy; a plain table stays a table', () => {
  const row = (...cells: EditorNode[]): EditorNode => ({ type: 'tableRow', content: cells });
  const merged = { type: 'table', content: [row(cell('a', { colspan: 2, rowspan: 1 })), row(cell('b'), cell('c'))] };
  assert.equal(documentToReadableMarkdown(doc(merged), link).markdown, 'Table: see the .tome.json file.');
  const plain = { type: 'table', content: [row(cell('a'), cell('b')), row(cell('c'), cell('d'))] };
  assert.match(documentToReadableMarkdown(doc(plain), link).markdown, /\| a +\| b +\|/);
});

test('colour, underline and alignment are dropped and counted', () => {
  const out = documentToReadableMarkdown(doc(
    p('สีแดง', [{ type: 'textColor', attrs: { color: 'red' } }], { textAlign: 'center' }),
    p('ขีดเส้นใต้', [{ type: 'underline' }, { type: 'bold' }]),
    p('left is no alignment', undefined, { textAlign: 'left' }),
  ), link);
  assert.equal(out.markdown, 'สีแดง\n\n**ขีดเส้นใต้**\n\nleft is no alignment');
  assert.equal(out.formattingNotShown, 3);
});

test('what MCP reads is unchanged: it still stands blocks in as lines', () => {
  const video = { type: 'video', attrs: { provider: 'youtube', videoId: 'dQw4w9WgXcQ', start: null, title: 'คลิป', mediaId: null } };
  assert.equal(documentToMarkdown(doc(video)).markdown, '{{tome:block 1}}');
});
