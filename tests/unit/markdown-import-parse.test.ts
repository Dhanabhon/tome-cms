import assert from 'node:assert/strict';
import test from 'node:test';

import { parseMarkdownPost, placePictures } from '../../src/server/content/markdown-import';
import { prepareEditorContent } from '../../src/server/content/editor';
import type { EditorDocument, EditorNode } from '../../src/types/cms';

const MEDIA = '55555555-5555-4555-8555-555555555555';
const nodes = (document: EditorDocument): EditorNode[] => {
  const all: EditorNode[] = [];
  const walk = (node: EditorNode) => { all.push(node); node.content?.forEach(walk); };
  document.content?.forEach(walk);
  return all;
};
const html = (document: EditorDocument) => prepareEditorContent({ contentJson: document }).contentHtml;

test('frontmatter fills the post, and the body is Thai Markdown the server accepts', () => {
  const parsed = parseMarkdownPost([
    '---',
    'title: ทดสอบนำเข้า',
    'slug: markdown-import-test',
    'locale: th',
    'date: 2022-05-01',
    'categories: [บันทึก, Notes]',
    'description: สรุปสั้นๆ',
    'meta_title: หัวข้อ SEO',
    'meta_description: คำอธิบาย SEO',
    'cover: ./images/cover.png',
    '---',
    '',
    '## หัวข้อ',
    '',
    'ย่อหน้าที่มี **ตัวหนา** *เอียง* ~~ขีด~~ `โค้ด` และ [ลิงก์](https://dhanabhon.com)',
    '',
    '| ก | ข |',
    '| --- | --- |',
    '| หนึ่ง | สอง |',
  ].join('\n'), 'post.md');
  assert.equal(parsed.title, 'ทดสอบนำเข้า');
  assert.equal(parsed.slug, 'markdown-import-test');
  assert.equal(parsed.locale, 'th');
  assert.equal(parsed.publishedAt, '2022-05-01T00:00:00.000Z');
  assert.deepEqual(parsed.categoryNames, ['บันทึก', 'Notes']);
  assert.equal(parsed.excerpt, 'สรุปสั้นๆ');
  assert.equal(parsed.metaTitle, 'หัวข้อ SEO');
  assert.equal(parsed.metaDescription, 'คำอธิบาย SEO');
  assert.deepEqual(parsed.cover, { src: './images/cover.png', name: 'cover.png', kind: 'local', where: 'cover' });
  assert.deepEqual(parsed.pictures, [parsed.cover]);
  assert.deepEqual(parsed.warnings, []);
  const rendered = html(parsed.document);
  assert.match(rendered, /<h2>หัวข้อ<\/h2>/);
  assert.match(rendered, /<strong>ตัวหนา<\/strong>/);
  assert.match(rendered, /<table>/);
});

test('with no frontmatter, the first level 1 heading is the title, then the file name', () => {
  const fromHeading = parseMarkdownPost('# ชื่อเรื่อง\n\nเนื้อหา', 'x.md');
  assert.equal(fromHeading.title, 'ชื่อเรื่อง');
  assert.equal(nodes(fromHeading.document).some((node) => node.type === 'heading'), false);
  const fromFile = parseMarkdownPost('เนื้อหาอย่างเดียว', 'my-note.MD');
  assert.equal(fromFile.title, 'my-note');
  assert.equal(fromFile.slug, '');
  assert.equal(fromFile.locale, null);
});

test('a file saved on Windows reads the same', () => {
  const parsed = parseMarkdownPost('﻿---\r\ntitle: Windows\r\n---\r\n\r\nBody\r\n', 'w.md');
  assert.equal(parsed.title, 'Windows');
  assert.deepEqual(parsed.warnings, []);
});

test('frontmatter that is not YAML is reported and the body still comes in', () => {
  const parsed = parseMarkdownPost('---\ntitle: [unclosed\n---\n\nBody text', 'broken.md');
  assert.deepEqual(parsed.warnings, [{ code: 'frontmatter-unreadable' }]);
  assert.equal(parsed.title, 'broken');
  assert.match(html(parsed.document), /Body text/);
});

test('a file that asks to publish, or has a date that cannot be read, says so', () => {
  const parsed = parseMarkdownPost('---\ntitle: T\nstatus: published\ndate: someday\n---\nx', 'a.md');
  assert.deepEqual(parsed.warnings, [{ code: 'status-ignored' }, { code: 'date-unreadable' }]);
  assert.equal(parsed.publishedAt, null);
  assert.deepEqual(parseMarkdownPost('---\ndraft: false\n---\nx', 'a.md').warnings, [{ code: 'status-ignored' }]);
  assert.deepEqual(parseMarkdownPost('---\nstatus: draft\n---\nx', 'a.md').warnings, []);
});

test('long frontmatter values are cut to what a post allows', () => {
  const parsed = parseMarkdownPost(`---\ntitle: ${'ก'.repeat(300)}\nexcerpt: ${'x'.repeat(200)}\nmeta_title: ${'y'.repeat(90)}\ncategories: [${Array.from({ length: 25 }, (_, i) => `c${i}`).join(', ')}]\n---\nx`, 'a.md');
  assert.equal(parsed.title.length, 200);
  assert.equal(parsed.excerpt.length, 120);
  assert.equal(parsed.metaTitle?.length, 70);
  assert.equal(parsed.categoryNames.length, 20);
});

test('headings deeper than 3 become level 3', () => {
  const parsed = parseMarkdownPost('#### สี่\n\n###### หก', 'a.md');
  const levels = nodes(parsed.document).filter((node) => node.type === 'heading').map((node) => node.attrs?.level);
  assert.deepEqual(levels, [3, 3]);
  assert.match(html(parsed.document), /<h3>สี่<\/h3><h3>หก<\/h3>/);
});

test('raw HTML is removed and counted, and never reaches the page', () => {
  const parsed = parseMarkdownPost('ก่อน\n\n<script>alert(1)</script>\n\n<div class="x">block</div>\n\nข้อความ <b>หนา</b> ต่อ', 'a.md');
  const rendered = html(parsed.document);
  assert.doesNotMatch(rendered, /script|&lt;|class="x"/);
  assert.match(rendered, /ก่อน/);
  assert.match(rendered, /หนา/);
  assert.deepEqual(parsed.warnings, [{ code: 'html-removed', count: 4 }]);
});

test('a footnote does not become a link to its own words', () => {
  const parsed = parseMarkdownPost('ข้อความ[^1]\n\n[^1]: เชิงอรรถ\n\n[ออก](https://a.com) [ภายใน](/about) [หัวข้อ](#top)', 'a.md');
  const hrefs = nodes(parsed.document).flatMap((node) => node.marks ?? []).filter((mark) => mark.type === 'link').map((mark) => mark.attrs?.href);
  assert.deepEqual(hrefs, ['https://a.com', '/about', '#top']);
  assert.deepEqual(parsed.warnings, [{ code: 'links-removed', count: 1 }]);
});

test('a task list is imported as a list and reported', () => {
  const parsed = parseMarkdownPost('- [ ] ยังไม่ทำ\n- [x] ทำแล้ว', 'a.md');
  assert.deepEqual(parsed.warnings, [{ code: 'task-list' }]);
  assert.match(html(parsed.document), /<ul>/);
});

test('pictures on their own lines leave no empty paragraphs, and every picture is listed once', () => {
  const parsed = parseMarkdownPost('ก่อน\n\n![a](./a.png)\n![b](https://x.com/b.jpg)\n![c](data:image/png;base64,AA)\n![a again](./a.png)\n\nหลัง', 'a.md');
  assert.equal(nodes(parsed.document).some((node) => node.type === 'paragraph' && !node.content?.length), false);
  assert.deepEqual(parsed.pictures.map((picture) => [picture.src, picture.kind]), [
    ['./a.png', 'local'], ['https://x.com/b.jpg', 'remote'], ['data:image/png;base64,AA', 'refused'],
  ]);
});

test('matched pictures move into the library, others from a site stay, and the rest become a line', () => {
  const parsed = parseMarkdownPost('![a](./a.png)\n\n![b](https://x.com/b.jpg)\n\n![c](./c.png)\n\nข้อความ ![d](./d.png) ต่อ', 'a.md');
  const placed = placePictures(parsed.document, new Map([['./a.png', MEDIA]]), 'th');
  const rendered = html(placed);
  assert.match(rendered, new RegExp(`src="/media/${MEDIA}"`));
  assert.match(rendered, /src="https:\/\/x\.com\/b\.jpg"/);
  assert.match(rendered, /<p>\[รูปที่ขาด: c\.png\]<\/p>/);
  // Inside a sentence, the line stays inside the sentence.
  assert.match(rendered, /<p>ข้อความ \[รูปที่ขาด: d\.png\] ต่อ<\/p>/);
  assert.match(html(placePictures(parsed.document, new Map(), 'en')), /\[Missing image: c\.png\]/);
});

test('a fenced block keeps its language, by the short names code usually carries', () => {
  const languages = (markdown: string) => nodes(parseMarkdownPost(markdown, 'a.md').document)
    .filter((node) => node.type === 'codeBlock')
    .map((node) => node.attrs?.language ?? null);
  assert.deepEqual(languages('```js\nconst a = 1;\n```\n\n```TS\nlet b;\n```\n\n```python\npass\n```'), ['javascript', 'typescript', 'python']);
  assert.deepEqual(languages('```\nplain\n```'), [null]);
  assert.deepEqual(languages('```ts title="a.ts"\nlet c;\n```'), ['typescript']);
  assert.deepEqual(languages('```klingon\nqapla\n```\n\n~~~\nx\n~~~'), [null, null]);
  const rendered = html(parseMarkdownPost('```js\nconst a = 1;\n```', 'a.md').document);
  assert.match(rendered, /<code class="language-javascript">/);
});

test('--- between paragraphs is a new part', () => {
  const parsed = parseMarkdownPost('ก่อน\n\n---\n\nหลัง', 'a.md');
  assert.deepEqual(parsed.document.content?.map((node) => node.type), ['paragraph', 'horizontalRule', 'paragraph']);
});
