import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

import { MarkdownManager } from '@tiptap/markdown';
import { MarkdownTooComplexError, parseMarkdownPost, placePictures } from '../../src/server/content/markdown-import';
import { jsonbTextLength, prepareEditorContent, ValidationError } from '../../src/server/content/editor';
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
  const parsed = parseMarkdownPost('\uFEFF---\r\ntitle: Windows\r\n---\r\n\r\nBody\r\n', 'w.md');
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

test('an empty frontmatter block is read as one, and trailing spaces after its dashes are fine', () => {
  const parsed = parseMarkdownPost('---\n---\nBody', 'empty.md');
  assert.deepEqual(parsed.document.content?.map((node) => node.type), ['paragraph']);
  assert.equal(parseMarkdownPost('---  \ntitle: Spaced\n---\t\nBody', 'a.md').title, 'Spaced');
});

test('a heading with no words is dropped, and the title still comes from the file name', () => {
  const parsed = parseMarkdownPost('# \n\nBody', 'named.md');
  assert.equal(parsed.title, 'named');
  assert.equal(nodes(parsed.document).some((node) => node.type === 'heading'), false);
});

test('only a web, site or page address survives as a link', () => {
  const parsed = parseMarkdownPost('[a](javascript:alert(1)) [b](JaVaScRiPt:x) [c](data:text/html,x) [d](//evil.com) [e](/\\evil.com) [f](/ok)', 'a.md');
  const hrefs = nodes(parsed.document).flatMap((node) => node.marks ?? []).filter((mark) => mark.type === 'link').map((mark) => mark.attrs?.href);
  assert.deepEqual(hrefs, ['/ok']);
  assert.deepEqual(parsed.warnings, [{ code: 'links-removed', count: 5 }]);
});

test('fence names with a symbol in them are taken for the language they stand for', () => {
  const languages = nodes(parseMarkdownPost('```c++\nint a;\n```\n\n```c#\nint b;\n```', 'a.md').document)
    .filter((node) => node.type === 'codeBlock').map((node) => node.attrs?.language);
  assert.deepEqual(languages, ['cpp', 'csharp']);
});

test('the same picture twice is placed in both spots', () => {
  const parsed = parseMarkdownPost('![a](./a.png)\n\nmiddle\n\n![a again](./a.png)', 'a.md');
  assert.equal(html(placePictures(parsed.document, new Map([['./a.png', MEDIA]]), 'th')).split(`src="/media/${MEDIA}"`).length - 1, 2);
});

test('frontmatter keys that are not fields do no harm', () => {
  const parsed = parseMarkdownPost('---\n__proto__: {polluted: true}\nconstructor: x\ntitle: T\n---\nx', 'a.md');
  assert.equal(parsed.title, 'T');
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  const bomb = ['a: &a [x, x, x, x, x, x, x, x, x]', ...'bcdefghi'.split('').map((key, i) => `${key}: &${key} [${`*${'abcdefgh'[i]}, `.repeat(9)}x]`), 'title: Bomb'].join('\n');
  assert.deepEqual(parseMarkdownPost(`---\n${bomb}\n---\nx`, 'a.md').warnings, [{ code: 'frontmatter-unreadable' }]);
});

// What one file may ask of the server. Each input is at most what the import accepts (900 KB) and
// is the shape that made the lexer take minutes before the limits; the bound is generous, the time
// is printed so a slow machine shows.
const MB = 900_000;
const timed = (name: string, input: string, limit: string | null) => test(name, (t) => {
  assert.ok(input.length <= MB, 'the input is within the import limit');
  const started = performance.now();
  let refused: string | null = null;
  try {
    parseMarkdownPost(input, 'big.md');
  } catch (error) {
    assert.ok(error instanceof MarkdownTooComplexError, String(error));
    refused = error.limit;
    assert.deepEqual(error.warning, { code: 'too-complex', limit });
  }
  const took = performance.now() - started;
  t.diagnostic(`${Math.round(took)} ms, ${refused ? `refused: ${refused}` : 'parsed'}`);
  assert.equal(refused, limit);
  // A refusal is at once. What is read may take seconds on a loaded runner, and must still end; so
  // may a block's lines, which are counted on marked's block tokens, and its lexer is slower than
  // linear on a long list (6 s on the release runner). In production the worker's time limit
  // bounds either way.
  const slow = limit === null || limit === 'html' || limit === 'block-lines';
  assert.ok(took < (slow ? 15_000 : 5_000), `took ${Math.round(took)} ms`);
});

timed('55,000 pictures, each in its own paragraph, are refused at once', '![a](./a.png)\n\n'.repeat(55_000), 'lines');
timed('2,500 pictures in one paragraph are refused at once', '![a](./a.png) '.repeat(2_500), 'pictures');
timed('501 pictures are refused at once, before any could be uploaded', '![a](./a.png) '.repeat(501), 'pictures');
timed('90,000 inline tags are refused at once', '<b>x</b>'.repeat(90_000), 'inline');
timed('25,000 links in one paragraph are refused at once', '[a](https://a.com) '.repeat(25_000), 'inline');
timed('100,000 headings are refused at once', '## h\n'.repeat(100_000), 'lines');
timed('5,000 headings are refused at once', '## h\n'.repeat(5_000), 'blocks');
timed('a code fence that is not one, then 290,000 emphases, is refused at once', '``` `\n' + '*a '.repeat(290_000), 'emphasis');
timed('the same with 100,000 tags is refused at once', '``` `\n' + '<b>x</b>'.repeat(100_000), 'inline');
timed('the same with 120,000 links is refused at once', '``` `\n' + '[a](x) '.repeat(120_000), 'inline');
timed('a fence inside an HTML block is not code, and 290,000 emphases after it are refused at once', '<div>\n```\n\n' + '*a '.repeat(290_000), 'emphasis');
timed('39,000 emphases in one paragraph are refused at once', '*a '.repeat(39_000), 'emphasis');
timed('20,000 underscores, tildes and mixed marks in one paragraph are refused at once', '_a ~b *c '.repeat(7_000), 'emphasis');
timed('400,000 list dashes on one line are read at once', '- '.repeat(400_000), null);
timed('450,000 short lines are refused at once', 'a\n'.repeat(450_000), 'lines');
timed('30,000 different tags in one paragraph are refused at once', Array.from({ length: 30_000 }, (_, i) => `<t${i}>`).join(''), 'inline');
timed('30,000 tags of 299 kinds, in paragraphs of 3,000, are read, and gone from the text', Array.from({ length: 10 }, () => Array.from({ length: 3_000 }, (_, i) => `<t${i % 299}>`).join(' ')).join('\n\n'), null);
// 102,000 words: 892 KB as the database measures the document, just inside what an import may use.
timed('a long post, 100,000 words and 500 pictures, is read whole', Array.from({ length: 100 }, (_, part) => [
  `## Part ${part}`,
  ...Array.from({ length: 15 }, (_, item) => `${'คำ word '.repeat(34)}${item % 5 === 0 ? ` **bold** and [link](https://x.com/${part}/${item}) and \`code\`` : ''}.${item % 3 === 0 ? `\n\n![pic](./img/${part}-${item}.png)` : ''}`),
  '- one\n- two',
].join('\n\n')).join('\n\n'), null);

test('more different tags than the limit allows are refused', () => {
  const source = Array.from({ length: 301 }, (_, i) => `<t${i}>`).join(' ');
  assert.throws(() => parseMarkdownPost(source, 'a.md'), (error) => error instanceof MarkdownTooComplexError && error.limit === 'html');
});

test('code is not read for marks, so a long listing does not count against the post', () => {
  const listing = '```js\n' + 'a_b * c[d] <e>\n'.repeat(8_000) + '```';
  assert.equal(nodes(parseMarkdownPost(listing, 'a.md').document).filter((node) => node.type === 'codeBlock').length, 1);
});

test('frontmatter over 20 KB is reported, not handed to the YAML reader, and the body still comes in', () => {
  const started = performance.now();
  const parsed = parseMarkdownPost(`---\n${Array.from({ length: 50_000 }, (_, i) => `k${i}: v`).join('\n')}\n---\nBody text`, 'keys.md');
  const took = performance.now() - started;
  assert.deepEqual(parsed.warnings, [{ code: 'frontmatter-unreadable' }]);
  assert.match(html(parsed.document), /Body text/);
  console.log(`# frontmatter of 50,000 keys: ${Math.round(took)} ms`);
  assert.ok(took < 5000);
});

test('a paragraph with 200 emphases is read', () => {
  const parsed = parseMarkdownPost('word *em* and **strong** '.repeat(200), 'a.md');
  assert.equal(nodes(parsed.document).filter((node) => node.marks?.length).length, 400);
});

// Hard-wrapped at 80 columns, there are many lines and few blocks; a listing is lines and no blocks.
const wrapped = (words: number) => Array.from({ length: words / 40 }, (_, i) => `Paragraph ${i}: ${'lorem ipsum dolor sit amet '.repeat(8)}`
  .replace(/(.{1,78})(\s|$)/g, '$1\n').trimEnd()).join('\n\n');
timed('100,000 words hard-wrapped at 80 columns, and a 3,000-line listing, are read whole', `${wrapped(100_000)}\n\n\`\`\`js\n${'const a = b; // one line of code\n'.repeat(3_000)}\`\`\`\n`, null);
timed('a listing of 11,000 lines, with blank lines and comments in it, is read whole',
  `\`\`\`python\n${Array.from({ length: 11_000 }, (_, i) => (i % 4 === 0 ? '' : i % 4 === 1 ? '# a comment' : i % 4 === 2 ? '> x' : '---')).join('\n')}\n\`\`\``, null);
// Shapes the first limits did not see: lines that belong to one block, blocks inside blocks, and
// link definitions, which the lexer takes out of the text.
timed('24,900 lazy lines in one list item are refused at once', `- a\n${'b\n'.repeat(24_900)}`, 'block-lines');
timed('a list item with marks and 24,000 lines is refused at once', `- ${'*a '.repeat(1_400)}\n${'  b\n'.repeat(24_000)}`, 'block-lines');
timed('12,000 paragraphs in one quote are refused at once', '> a *b*\n>\n'.repeat(12_000), 'block-lines');
timed('a task item with 12,000 lazy lines is refused at once', `- [ ] a\n${'b\n'.repeat(12_000)}`, 'block-lines');
timed('4,750 paragraphs in five quotes are counted as blocks, and refused at once', `${'> a\n>\n'.repeat(950)}\n`.repeat(5), 'blocks');
timed('24,000 link definitions are refused at once', '[a]: http://x\n'.repeat(24_000), 'definitions');
timed('12,000 footnote definitions are refused at once', '[^1]: a\n'.repeat(12_000), 'definitions');
// Code, tables and HTML are read once wherever they are, so inside a list item or quote they are not its lines.
const listing = (indent: string) => `${indent}\`\`\`js\n${`${indent}const a = b; // one line of code\n`.repeat(2_500)}${indent}\`\`\``;
timed('a 2,500-line listing inside a list item is read whole', `1. Save this:\n\n${listing('   ')}\n`, null);
timed('a 2,500-line listing inside a quote is read whole', `> Save this:\n>\n${listing('> ')}\n`, null);
timed('a 2,500-row table inside a list item is read whole', `- Results:\n\n  | a | b |\n  | - | - |\n${'  | 1 | 2 |\n'.repeat(2_500)}`, null);
timed('a list item of 2,100 lines around a short listing is still refused', `- a\n${'b\n'.repeat(2_100)}\n  \`\`\`\n  x\n  \`\`\`\n`, 'block-lines');
timed('a table of 3,000 rows is read whole', `| a | b |\n| - | - |\n${'| 1 | 2 |\n'.repeat(3_000)}`, null);
timed('a list of 6,000 items is read whole', '- a\n'.repeat(6_000), null);
// A post stores its document and its page, each capped at a million bytes, and both are larger than the Markdown.
timed('3,500 paragraphs of 225 characters (794 KB) would be too big to store, and are refused', Array.from({ length: 3_500 }, (_, i) => `${i} ${'x'.repeat(220)}`).join('\n\n'), 'size');
timed('a listing whose highlighted page would be too big to store is refused', `\`\`\`js\n${'x = f(a, b) + [1, 2, 3].map(n => n * 2);\n'.repeat(21_000)}\`\`\``, 'size');
// The database measures the document as it prints jsonb, with a space after each ':' and ','; on
// many small nodes that is a tenth larger than JSON.stringify, and these passed it (the review's probes).
timed('513 paragraphs of short italics, under the cap as JSON but over it as the database stores it, are refused',
  Array.from({ length: 513 }, () => '*ab* cd '.repeat(20)).join('\n\n'), 'size');
timed('701 paragraphs of ten links each are refused the same way', Array.from({ length: 701 }, () => '[a](https://x.io) '.repeat(10)).join('\n\n'), 'size');
timed('2,500 paragraphs of 200 characters (516 KB) are read whole', Array.from({ length: 2_500 }, (_, i) => `${i} ${'x'.repeat(200)}`).join('\n\n'), null);
timed('a listing over the line limit is refused for its lines, not its blocks', `\`\`\`\n${'\n'.repeat(26_000)}\`\`\``, 'lines');

test('a file nested too deeply is refused with an error the service can show, never a stack overflow', () => {
  const lists = Array.from({ length: 300 }, (_, level) => `${'  '.repeat(level)}- item`).join('\n');
  for (const source of [lists, `${'> '.repeat(3_000)}text`]) {
    assert.throws(() => parseMarkdownPost(source, 'deep.md'), (error) => {
      assert.ok(error instanceof MarkdownTooComplexError);
      assert.equal(error.limit, 'depth');
      return true;
    });
  }
});

test('any other error from the parser is a plain refusal with nothing of its insides in it', () => {
  const parse = mock.method(MarkdownManager.prototype, 'parse', () => { throw new Error('internal detail: /srv/app/secret.ts'); });
  try {
    assert.throws(() => parseMarkdownPost('Some text', 'a.md'), (error) => {
      assert.ok(error instanceof ValidationError);
      assert.ok(!(error instanceof MarkdownTooComplexError));
      assert.equal(error.message, 'This file could not be read as Markdown.');
      return true;
    });
  } finally {
    parse.mock.restore();
  }
});

test('a document is measured as the database prints it: a space after each key and between items', () => {
  // Postgres: select '{"a":[1,2],"b":{"c":"ก\n"}}'::jsonb::text  ->  {"a": [1, 2], "b": {"c": "ก\n"}}
  assert.equal(jsonbTextLength({ a: [1, 2], b: { c: 'ก\n' } }), new TextEncoder().encode('{"a": [1, 2], "b": {"c": "ก\\n"}}').byteLength);
  assert.equal(jsonbTextLength({ type: 'doc', content: [] }), '{"type": "doc", "content": []}'.length);
  assert.equal(jsonbTextLength({}), 2);
});

test('500 different pictures and a cover are one too many to match, and the same picture written often is one', () => {
  const body = (count: number) => Array.from({ length: count }, (_, index) => `![p](./p${index}.png)`).join('\n\n');
  assert.equal(parseMarkdownPost(body(500), 'a.md').pictures.length, 500);
  assert.throws(() => parseMarkdownPost(`---\ncover: ./cover.png\n---\n${body(500)}`, 'a.md'),
    (error) => error instanceof MarkdownTooComplexError && error.limit === 'pictures');
  assert.equal(parseMarkdownPost('![p](./p.png)\n\n'.repeat(400), 'a.md').pictures.length, 1);
});

test('a file named .md or .markdown gives its name as the title without the extension', () => {
  assert.equal(parseMarkdownPost('Some words.', 'field-notes.markdown').title, 'field-notes');
  assert.equal(parseMarkdownPost('Some words.', 'Field-Notes.MD').title, 'Field-Notes');
});
