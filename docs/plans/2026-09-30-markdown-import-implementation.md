# Markdown Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner turn one `.md` file into one draft post. The owner matches the file's pictures
to picture files by hand.

**Architecture:**
- A pure module in `src/lib/markdown-import.ts` holds the shapes and picture rules that the browser
  and the server share.
- A pure server module parses a file with `@tiptap/markdown`, using the server's own editor
  extensions, and cleans up what the spike found. It has no database.
- A service resolves language, categories and slug against the database, then calls the existing
  `createPost`.
- Two thin admin routes: one only reads the file (preview), the other imports it.
- One React island on the post list runs the three steps.

**Tech Stack:** Astro 7, React, Tiptap 3.31.3 with `@tiptap/markdown` 3.31.3 (brings `marked`), `yaml`
2.9, zod 4, Kysely, `node:test`, Playwright.

**Spec:** `docs/specs/2026-09-30-markdown-import-design.md`

## Global Constraints

- **Start only after 1.5.1 is merged into develop.** Another session is changing `feature/release-1.5.1`
  now. Work on a branch cut from develop after that merge.
- **Git:**
  - never `git stash`;
  - stage each file by its path;
  - write each commit message to a scratchpad file and run `git commit -F <file>` in its own call;
  - no `Co-Authored-By` or "Generated with" lines, which the commit-msg hook rejects.
- **Dependency:** `@tiptap/markdown` is pinned exactly to `3.31.3`, like every other `@tiptap/*`
  package in `package.json`.
- **Always a draft:** an import is always `status: 'draft'`, whatever the file says.
- **Missing picture text:** a skipped picture becomes `[รูปที่ขาด: name]` in a Thai post and
  `[Missing image: name]` in an English one. The language is the post's, not the admin's.
- **No fetching:** the server never fetches a picture from an address in the file.
- **Size:** the file text is at most `MAX_MARKDOWN_BYTES = 900_000` UTF-8 bytes. The admin JSON body
  cap is 1 MB (`src/server/http/json.ts`), and the text has to fit inside it with its wrapper.
- **Frontmatter limits:** title 200 characters, excerpt 120, meta title 70, meta description 320,
  at most 20 categories.
- **Headings:** the schema has levels 1–3 only.
- **Copy:** every string the owner sees is in both `en` and `th` in `src/lib/admin-i18n.ts`, and
  the Thai must read naturally.

## Review Focus

1. **A file saved on Windows** (CRLF line endings, a UTF-8 BOM) must read its frontmatter like any
   other file. Test in Task 2.
2. **A slug another post in the same language already uses** must import with a changed slug and say
   so, not fail with 409. Test in Task 3.
3. **One picture file used twice in the body** (the same `src` twice) must upload once and fill both
   places. Unit test for `matchFiles` in Task 1; e2e in Task 4 uses the same file twice.
4. **A `pictures` map that names a `mediaId` from another owner, or a document** must be refused by
   the existing media check. Test in Task 3.
5. **A picture inside a sentence that is skipped** must become inline text, not a paragraph inside a
   paragraph. Test in Task 2.

## Where the plan differs from the spec

The spec was approved before these were known. Task 4 updates the spec to match.

- **The report shows in the sheet,** with an "Open the draft" link, not above the editor. The editor
  is left untouched.
- **The size limit is 900 KB,** not 1 MB, so the text fits in the JSON body.
- **Every empty top-level paragraph is removed,** not only those beside pictures. Markdown cannot
  write an empty paragraph on purpose.
- **A taken slug gets an 8-character suffix** and a warning. The spec did not say what happens then.
- **`npm run check:inventory` does not apply.** It checks migrations, not dependencies, so that line
  of the spec is removed.

---

### Task 1: The dependency and the shared picture rules

**Files:**
- Modify: `package.json`, `package-lock.json` (via npm)
- Modify: `src/server/content/editor.ts:48` (export the extensions)
- Create: `src/lib/markdown-import.ts`
- Test: `tests/unit/markdown-import-pictures.test.ts`

**Interfaces:**
- Produces:
  - `MAX_MARKDOWN_BYTES: number` (900_000)
  - `MISSING_IMAGE: { th: string; en: string }`
  - `type PictureKind = 'local' | 'remote' | 'refused'`
  - `interface ImportPicture { src: string; name: string; kind: PictureKind; where: 'body' | 'cover' }`
  - `type ImportWarning` (the union below)
  - `describePicture(src: string, where: 'body' | 'cover'): ImportPicture`
  - `pictureLabel(picture: ImportPicture): string`
  - `needsFile(picture: ImportPicture): boolean`
  - `matchFiles<F extends { name: string }>(pictures, files, current?): Map<string, F>`
  - `extensions` exported from `src/server/content/editor.ts`

- [ ] **Step 1: Add the dependency**

Run: `npm install --save-exact @tiptap/markdown@3.31.3`
Expected: `package.json` gains `"@tiptap/markdown": "3.31.3"`, and the lock file gains `marked`.

- [ ] **Step 2: Export the server's extensions**

In `src/server/content/editor.ts`, change line 48 from `const extensions = [` to
`export const extensions = [`. Nothing else in the file changes.

- [ ] **Step 3: Write the failing test**

```ts
// tests/unit/markdown-import-pictures.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { describePicture, matchFiles, needsFile, pictureLabel } from '../../src/lib/markdown-import';

test('a picture is local, from another site, or refused, by how the file writes its address', () => {
  assert.equal(describePicture('./images/Cover.PNG', 'body').kind, 'local');
  assert.equal(describePicture('diagram.png', 'body').kind, 'local');
  assert.equal(describePicture('/uploads/a.jpg', 'body').kind, 'local');
  assert.equal(describePicture('https://i.imgur.com/abc.jpg', 'body').kind, 'remote');
  assert.equal(describePicture('HTTP://x.com/a.png', 'body').kind, 'remote');
  assert.equal(describePicture('data:image/png;base64,iVBORw0KGgo=', 'body').kind, 'refused');
  assert.equal(describePicture('//cdn.example.com/a.png', 'body').kind, 'refused');
  assert.equal(describePicture('javascript:alert(1)', 'body').kind, 'refused');
  assert.equal(describePicture('   ', 'body').kind, 'refused');
});

test('a picture is matched by its file name, without its folder, query or case', () => {
  assert.equal(describePicture('./images/Cover.PNG', 'body').name, 'Cover.PNG');
  assert.equal(describePicture('https://x.com/a/b%20c.jpg?w=10#top', 'body').name, 'b c.jpg');
  assert.equal(describePicture('data:image/png;base64,AAAA', 'body').name, '');
  assert.equal(pictureLabel(describePicture('./images/Cover.PNG', 'body')), 'Cover.PNG');
  assert.equal(pictureLabel(describePicture('data:image/png;base64,AAAA', 'body')), 'data:image/png;base64,AAAA');
});

test('a cover from another site needs a file, because a cover lives in the library', () => {
  assert.equal(needsFile(describePicture('https://x.com/a.png', 'body')), false);
  assert.equal(needsFile(describePicture('https://x.com/a.png', 'cover')), true);
  assert.equal(needsFile(describePicture('a.png', 'body')), true);
  assert.equal(needsFile(describePicture('data:image/png;base64,AA', 'body')), false);
});

test('one dropped file fills every picture with its name, and a file with no picture is ignored', () => {
  const pictures = [
    describePicture('./a/one.png', 'body'),
    describePicture('../b/ONE.png', 'body'),
    describePicture('https://x.com/two.jpg', 'body'),
    describePicture('data:image/png;base64,AA', 'body'),
  ];
  const one = { name: 'one.png' };
  const two = { name: 'Two.JPG' };
  const matched = matchFiles(pictures, [one, two, { name: 'unused.gif' }]);
  assert.equal(matched.get('./a/one.png'), one);
  assert.equal(matched.get('../b/ONE.png'), one);
  assert.equal(matched.get('https://x.com/two.jpg'), two);
  assert.equal(matched.size, 3);
  // A second drop keeps the first matches and replaces only what it names again.
  const again = { name: 'one.png' };
  const next = matchFiles(pictures, [again], matched);
  assert.equal(next.get('./a/one.png'), again);
  assert.equal(next.get('https://x.com/two.jpg'), two);
});
```

- [ ] **Step 4: Run the test to see it fail**

Run: `node --import tsx --test tests/unit/markdown-import-pictures.test.ts`
Expected: FAIL, because `src/lib/markdown-import` cannot be found.

- [ ] **Step 5: Write the module**

```ts
// src/lib/markdown-import.ts
/**
 * What the import sheet and the server agree on about a Markdown file: how its pictures are told
 * apart and matched to files the owner drops, and the warnings a report can carry.
 */

/** The text of one file. The admin's JSON body is capped at 1 MB and carries this with its wrapper. */
export const MAX_MARKDOWN_BYTES = 900_000;

/** The words of a skipped picture's line, in the post's language, not the admin's. */
export const MISSING_IMAGE = { th: 'รูปที่ขาด', en: 'Missing image' } as const;

export type PictureKind = 'local' | 'remote' | 'refused';

export interface ImportPicture {
  /** The address exactly as the file writes it: the key a match is sent back under. */
  src: string;
  /** The file name a dropped file is matched against, as written; '' for a refused picture. */
  name: string;
  kind: PictureKind;
  where: 'body' | 'cover';
}

export type ImportWarning =
  | { code: 'frontmatter-unreadable' }
  | { code: 'status-ignored' }
  | { code: 'date-unreadable' }
  | { code: 'html-removed'; count: number }
  | { code: 'links-removed'; count: number }
  | { code: 'task-list' }
  | { code: 'category-missing'; names: string[] }
  | { code: 'slug-changed'; slug: string };

function kindOf(src: string): PictureKind {
  if (/^https?:\/\//i.test(src)) return 'remote';
  // Any other scheme (data:, javascript:, file:) and a protocol-relative address are refused.
  if (src.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(src)) return 'refused';
  return src.trim() ? 'local' : 'refused';
}

function fileName(src: string): string {
  const path = src.split(/[?#]/, 1)[0] ?? '';
  const last = path.slice(path.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

export function describePicture(src: string, where: 'body' | 'cover'): ImportPicture {
  const kind = kindOf(src);
  return { src, name: kind === 'refused' ? '' : fileName(src), kind, where };
}

/** What a picture is called in the sheet and in its missing-picture line. */
export function pictureLabel(picture: ImportPicture): string {
  return picture.name || picture.src.slice(0, 40);
}

/** A cover lives in the library, so one from another site needs a file as well. */
export function needsFile(picture: ImportPicture): boolean {
  return picture.kind === 'local' || (picture.kind === 'remote' && picture.where === 'cover');
}

/**
 * Gives each dropped file to every picture with its name, ignoring case. Matches already made are
 * kept; a file dropped again under the same name replaces the earlier one.
 */
export function matchFiles<F extends { name: string }>(
  pictures: readonly ImportPicture[],
  files: readonly F[],
  current: ReadonlyMap<string, F> = new Map(),
): Map<string, F> {
  const byName = new Map(files.map((file) => [file.name.toLowerCase(), file]));
  const next = new Map(current);
  for (const picture of pictures) {
    const file = picture.name ? byName.get(picture.name.toLowerCase()) : undefined;
    if (file) next.set(picture.src, file);
  }
  return next;
}
```

- [ ] **Step 6: Run the test to see it pass**

Run: `node --import tsx --test tests/unit/markdown-import-pictures.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/server/content/editor.ts src/lib/markdown-import.ts tests/unit/markdown-import-pictures.test.ts
```

Message file: `feat: the picture rules a Markdown import shares with its sheet`. Then run
`git commit -F <file>` on its own.

---

### Task 2: Parsing a file into a post

**Files:**
- Create: `src/server/content/markdown-import.ts`
- Test: `tests/unit/markdown-import-parse.test.ts`

**Interfaces:**
- Consumes (Task 1): `describePicture`, `pictureLabel`, `pictureKind` through `describePicture`,
  `MISSING_IMAGE`, `ImportPicture`, `ImportWarning`, and `extensions` from `./editor`.
- Produces:
  - `interface ParsedMarkdownPost { title: string; slug: string; locale: 'th' | 'en' | null;
    publishedAt: string | null; categoryNames: string[]; excerpt: string;
    metaTitle: string | null; metaDescription: string | null; cover: ImportPicture | null;
    document: EditorDocument; pictures: ImportPicture[]; warnings: ImportWarning[] }`
  - `parseMarkdownPost(source: string, fileName: string): ParsedMarkdownPost`
  - `placePictures(document: EditorDocument, matches: ReadonlyMap<string, string>, locale: 'th' | 'en'): EditorDocument`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/markdown-import-parse.test.ts
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
```

- [ ] **Step 2: Run the test to see it fail**

Run: `node --import tsx --test tests/unit/markdown-import-parse.test.ts`
Expected: FAIL, because `src/server/content/markdown-import` cannot be found.

- [ ] **Step 3: Write the module**

```ts
// src/server/content/markdown-import.ts
import { MarkdownManager } from '@tiptap/markdown';
import { parse as parseYaml } from 'yaml';

import {
  describePicture,
  MISSING_IMAGE,
  pictureLabel,
  type ImportPicture,
  type ImportWarning,
} from '../../lib/markdown-import';
import type { EditorDocument, EditorNode } from '../../types/cms';
import { extensions } from './editor';

/**
 * One Markdown file, read into what a new post is made of. No database: the service decides
 * language, categories and slug against the site. The parser is built from the server's own
 * extensions, so nothing it makes is a node the server cannot render. On a server there is no
 * `window`, so raw HTML comes out as text, never as markup; it is then removed here.
 */
const markdown = new MarkdownManager({ extensions });

const FRONTMATTER = /^---\n([\s\S]*?)\n---(?:\n|$)/;
// ponytail: matched on the raw text, so a task item inside a code block also warns; it is only a warning.
const TASK_ITEM = /^\s*[-*+] \[[ xX]\] /m;
// A footnote reference comes out as a link to the footnote's words; only these are real.
const KEPT_LINK = /^(?:https?:|\/|#)/i;

export interface ParsedMarkdownPost {
  title: string;
  /** As the file asked, trimmed; '' lets the post make one from its title. */
  slug: string;
  locale: 'th' | 'en' | null;
  publishedAt: string | null;
  categoryNames: string[];
  excerpt: string;
  metaTitle: string | null;
  metaDescription: string | null;
  cover: ImportPicture | null;
  document: EditorDocument;
  /** The cover first, then each body picture once, in the order the file has them. */
  pictures: ImportPicture[];
  warnings: ImportWarning[];
}

function text(value: unknown, max: number): string {
  if (typeof value === 'number') return String(value).slice(0, max);
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function readFrontmatter(yaml: string, warnings: ImportWarning[]): Record<string, unknown> {
  try {
    const value: unknown = parseYaml(yaml);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    if (value === null) return {};
  } catch {
    // Reported below.
  }
  warnings.push({ code: 'frontmatter-unreadable' });
  return {};
}

/** The raw text of every HTML token, found with the same lexer the parser uses. */
function htmlTokens(body: string): string[] {
  const found: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const token = value as { type?: unknown; raw?: unknown };
    if (token.type === 'html' && typeof token.raw === 'string' && token.raw.trim()) found.push(token.raw.trim());
    for (const child of Object.values(value)) if (child && typeof child === 'object') visit(child);
  };
  visit(markdown.instance.lexer(body));
  return found;
}

function plainText(node: EditorNode): string {
  return node.text ?? (node.content ?? []).map(plainText).join('');
}

function clean(node: EditorNode, html: readonly string[], counts: { links: number }, inCode: boolean): EditorNode | null {
  if (node.type === 'text') {
    const isCode = inCode || Boolean(node.marks?.some((mark) => mark.type === 'code'));
    let value = node.text ?? '';
    if (!isCode) for (const raw of html) value = value.split(raw).join('');
    if (!value.trim() && value !== node.text) return null;
    const marks = node.marks?.filter((mark) => {
      if (mark.type !== 'link') return true;
      const kept = KEPT_LINK.test(String(mark.attrs?.href ?? ''));
      if (!kept) counts.links += 1;
      return kept;
    });
    const next: EditorNode = { ...node, text: value };
    if (marks?.length) next.marks = marks;
    else delete next.marks;
    return next;
  }
  const attrs = node.type === 'heading' && Number(node.attrs?.level) > 3 ? { ...node.attrs, level: 3 } : node.attrs;
  if (!node.content) return attrs === node.attrs ? node : { ...node, attrs };
  const content = node.content
    .map((child) => clean(child, html, counts, inCode || node.type === 'codeBlock'))
    .filter((child): child is EditorNode => child !== null);
  return { ...node, ...(attrs ? { attrs } : {}), content };
}

export function parseMarkdownPost(source: string, fileName: string): ParsedMarkdownPost {
  const input = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const warnings: ImportWarning[] = [];
  const found = FRONTMATTER.exec(input);
  const fields = found ? readFrontmatter(found[1] ?? '', warnings) : {};
  const body = found ? input.slice(found[0].length) : input;

  const status = fields.status === undefined ? 'draft' : String(fields.status).trim().toLowerCase();
  if (status !== 'draft' || fields.published === true || fields.draft === false) warnings.push({ code: 'status-ignored' });

  let publishedAt: string | null = null;
  if (fields.date !== undefined && fields.date !== null && fields.date !== '') {
    const date = fields.date instanceof Date ? fields.date : new Date(String(fields.date));
    if (Number.isNaN(date.getTime())) warnings.push({ code: 'date-unreadable' });
    else publishedAt = date.toISOString();
  }

  const html = htmlTokens(body).sort((left, right) => right.length - left.length);
  // A round trip through JSON drops the `content: undefined` the parser leaves on an inline picture,
  // which the server's check refuses as not JSON.
  const parsed = JSON.parse(JSON.stringify(markdown.parse(body))) as EditorDocument;
  const counts = { links: 0 };
  let blocks = (parsed.content ?? [])
    .map((node) => clean(node, html, counts, false))
    .filter((node): node is EditorNode => node !== null)
    // Markdown cannot write an empty paragraph on purpose; the parser adds them around pictures.
    .filter((node) => node.type !== 'paragraph' || Boolean(node.content?.length));
  if (html.length) warnings.push({ code: 'html-removed', count: html.length });
  if (counts.links) warnings.push({ code: 'links-removed', count: counts.links });
  if (TASK_ITEM.test(body)) warnings.push({ code: 'task-list' });

  let title = text(fields.title, 200);
  if (!title) {
    const first = blocks.findIndex((node) => node.type === 'heading' && node.attrs?.level === 1);
    const heading = first === -1 ? '' : plainText(blocks[first]!).trim().slice(0, 200);
    if (heading) {
      title = heading;
      blocks = blocks.filter((_, index) => index !== first);
    }
  }
  if (!title) title = fileName.replace(/\.md$/i, '').trim().slice(0, 200) || 'Untitled';

  const locale = text(fields.locale, 2).toLowerCase();
  const rawCategories = Array.isArray(fields.categories) ? fields.categories : fields.categories === undefined ? [] : [fields.categories];
  const categoryNames = [...new Set(rawCategories.map((name) => text(name, 80)).filter(Boolean))].slice(0, 20);
  const coverSrc = text(fields.cover ?? fields.image, 4096);
  const cover = coverSrc ? describePicture(coverSrc, 'cover') : null;

  const document: EditorDocument = { type: 'doc', content: blocks };
  const seen = new Set<string>();
  const pictures: ImportPicture[] = cover ? [cover] : [];
  const collect = (node: EditorNode): void => {
    const src = node.type === 'image' ? String(node.attrs?.src ?? '') : '';
    if (src && !seen.has(src)) {
      seen.add(src);
      pictures.push(describePicture(src, 'body'));
    }
    node.content?.forEach(collect);
  };
  blocks.forEach(collect);

  return {
    title,
    slug: text(fields.slug, 160),
    locale: locale === 'th' || locale === 'en' ? locale : null,
    publishedAt,
    categoryNames,
    excerpt: text(fields.excerpt ?? fields.description, 120),
    metaTitle: text(fields.meta_title, 70) || null,
    metaDescription: text(fields.meta_description, 320) || null,
    cover,
    document,
    pictures,
    warnings,
  };
}

/**
 * The document with each matched picture in the library, each picture from another site left where
 * it is, and every other picture replaced by a line saying which is missing: a paragraph where the
 * picture stood alone, and words where it stood in a sentence.
 */
export function placePictures(document: EditorDocument, matches: ReadonlyMap<string, string>, locale: 'th' | 'en'): EditorDocument {
  const place = (node: EditorNode, inline: boolean): EditorNode => {
    if (node.type === 'image') {
      const picture = describePicture(String(node.attrs?.src ?? ''), 'body');
      const mediaId = matches.get(picture.src);
      if (mediaId) return { ...node, attrs: { ...node.attrs, src: `/media/${mediaId}`, mediaId } };
      if (picture.kind === 'remote') return node;
      const line: EditorNode = { type: 'text', text: `[${MISSING_IMAGE[locale]}: ${pictureLabel(picture)}]` };
      return inline ? line : { type: 'paragraph', content: [line] };
    }
    if (!node.content) return node;
    const holdsText = node.type === 'paragraph' || node.type === 'heading';
    return { ...node, content: node.content.map((child) => place(child, holdsText)) };
  };
  return { ...document, content: (document.content ?? []).map((node) => place(node, false)) };
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `node --import tsx --test tests/unit/markdown-import-parse.test.ts`
Expected: PASS, 12 tests.

If the HTML test fails, check what `markdown.parse` makes of inline `<b>`, and adjust `clean` rather
than the test. Log `JSON.stringify(markdown.parse(body))` once to see. Its count of 4 is the lexer's:
`<script>…</script>`, the `<div>` block, `<b>` and `</b>`. If the lexer reports a different number
of tokens, change the expected count to the lexer's and say why in the commit message. What must
hold is that no tag and no `&lt;` reaches the rendered HTML.

- [ ] **Step 5: Run the whole unit suite**

Run: `npm run test:unit`
Expected: every test passes, including `editor-rendering`, which proves exporting `extensions` changed
nothing.

- [ ] **Step 6: Commit**

```bash
git add src/server/content/markdown-import.ts tests/unit/markdown-import-parse.test.ts
```

Message: `feat: read a Markdown file into a draft's fields and document`. Then run `git commit -F`
on its own.

---

### Task 3: Previewing and importing, against the site

**Files:**
- Modify: `src/server/content/posts.ts:131-136` (the `else` branch of `createPost`)
- Create: `src/server/content/markdown-import-post.ts`
- Create: `src/pages/api/admin/posts/import/preview.ts`
- Create: `src/pages/api/admin/posts/import/index.ts`
- Test: `tests/integration/markdown-import.test.ts`

**Interfaces:**
- Consumes (Tasks 1–2): `parseMarkdownPost`, `placePictures`, `MAX_MARKDOWN_BYTES`, `ImportPicture`,
  `ImportWarning`.
- Produces:
  - `markdownImportSchema` (zod): `{ fileName: string; text: string; pictures?: Record<string, string> }`
  - `interface MarkdownImportPreview { title: string; slug: string; locale: 'th' | 'en'; categories: string[]; pictures: ImportPicture[]; warnings: ImportWarning[] }`
  - `previewMarkdownImport(ownerId: string, input: MarkdownImportInput): Promise<MarkdownImportPreview>`
  - `importMarkdownPost(ownerId: string, input: MarkdownImportInput): Promise<{ post: Post; warnings: ImportWarning[] }>`
  - `POST /api/admin/posts/import/preview` → `200 { preview: MarkdownImportPreview }`
  - `POST /api/admin/posts/import` → `201 { post: Post; warnings: ImportWarning[] }`

- [ ] **Step 1: Write the failing integration test**

```ts
// tests/integration/markdown-import.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import type { SupportedImageType } from '../../src/types/cms';

test('a Markdown file becomes a draft in its own language, with its pictures, categories and date', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(
    process.env.DATABASE_URL,
    'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
    'use only the disposable Foundation database',
  );
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { importMarkdownPost, previewMarkdownImport } = await import('../../src/server/content/markdown-import-post');
  const { createPost } = await import('../../src/server/content/posts');
  const { HttpError } = await import('../../src/server/http/errors');
  context.after(closeDatabase);

  await migrateToLatest();
  await db.deleteFrom('site_settings').execute();
  await db.deleteFrom('user').execute();
  for (const id of ['owner-a', 'owner-b']) {
    await db.insertInto('user').values({ id, name: id, email: `${id}@example.invalid`, emailVerified: true, image: null, role: 'owner' }).execute();
  }
  await db.insertInto('site_settings').values({
    id: true, owner_id: 'owner-a', site_name: 'Import', default_locale: 'th', timezone: 'UTC', admin_path: '/admin', author_avatar_media_id: null,
  }).execute();
  const [fallback, notes] = await db.insertInto('categories').values([
    { owner_id: 'owner-a', name: 'Uncategorized', is_default: true },
    { owner_id: 'owner-a', name: 'Notes', is_default: false },
  ]).returningAll().execute();

  // Copy the media row's other columns from tests/integration/published-api-queries.test.ts:41-52.
  const mine = '11111111-1111-4111-8111-111111111111';
  const theirs = '22222222-2222-4222-8222-222222222222';
  const mediaBase = {
    folder_id: null, original_name: 'a.webp', mime_type: 'image/webp' as SupportedImageType, size_bytes: 1_024,
    checksum_sha256: 'A'.repeat(43) + '=', width: 1600, height: 900,
  };
  await db.insertInto('media_items').values([
    { ...mediaBase, id: mine, owner_id: 'owner-a', object_key: 'owners/a/2026/09/a.webp' },
    { ...mediaBase, id: theirs, owner_id: 'owner-b', object_key: 'owners/b/2026/09/b.webp' },
  ]).execute();

  const file = [
    '---', 'title: An English post', 'locale: en', 'date: 2021-03-04T05:06:07Z', 'categories: [notes, Missing one]',
    'cover: ./cover.webp', 'status: published', '---', '',
    '![one](./one.webp)', '', '![site](https://x.com/s.jpg)', '', '![two](./two.webp)', '',
  ].join('\n');

  const preview = await previewMarkdownImport('owner-a', { fileName: 'a.md', text: file });
  assert.equal(preview.locale, 'en');
  assert.equal(preview.slug, 'an-english-post');
  assert.deepEqual(preview.categories, ['Notes']);
  assert.deepEqual(preview.pictures.map((picture) => picture.src), ['./cover.webp', './one.webp', 'https://x.com/s.jpg', './two.webp']);
  assert.deepEqual(preview.warnings, [{ code: 'status-ignored' }, { code: 'category-missing', names: ['Missing one'] }]);

  const { post, warnings } = await importMarkdownPost('owner-a', {
    fileName: 'a.md', text: file, pictures: { './cover.webp': mine, './one.webp': mine },
  });
  assert.equal(post.locale, 'en', 'the file\'s language, not the site default');
  assert.equal(post.status, 'draft', 'always a draft');
  assert.equal(post.cover_media_id, mine);
  assert.equal(post.planned_at, '2021-03-04T05:06:07.000Z');
  assert.match(post.content_html, new RegExp(`/media/${mine}`));
  assert.match(post.content_html, /https:\/\/x\.com\/s\.jpg/);
  assert.match(post.content_html, /\[Missing image: two\.webp\]/);
  assert.deepEqual(warnings, preview.warnings);
  const assigned = await db.selectFrom('post_category_assignments').select('category_id')
    .where('translation_group_id', '=', post.translation_group_id).execute();
  assert.deepEqual(assigned.map(({ category_id }) => category_id), [notes!.id]);

  // The same slug again, in the same language: a changed slug and a warning, not a 409.
  const second = await importMarkdownPost('owner-a', { fileName: 'a.md', text: file });
  assert.match(second.post.slug, /^an-english-post-[0-9a-f]{8}$/);
  assert.deepEqual(second.warnings.at(-1), { code: 'slug-changed', slug: second.post.slug });
  // With no matching category the post gets the default one.
  const plain = await importMarkdownPost('owner-a', { fileName: 'หมายเหตุ.md', text: 'ข้อความ' });
  assert.equal(plain.post.locale, 'th');
  assert.equal(plain.post.title, 'หมายเหตุ');
  const plainCategories = await db.selectFrom('post_category_assignments').select('category_id')
    .where('translation_group_id', '=', plain.post.translation_group_id).execute();
  assert.deepEqual(plainCategories.map(({ category_id }) => category_id), [fallback!.id]);

  // Another owner's picture is refused by the media check createPost already runs.
  await assert.rejects(
    importMarkdownPost('owner-a', { fileName: 'b.md', text: '![x](./x.webp)', pictures: { './x.webp': theirs } }),
    (error) => error instanceof HttpError || error instanceof Error,
  );
  // A file over the limit is refused before it is parsed.
  await assert.rejects(
    previewMarkdownImport('owner-a', { fileName: 'big.md', text: 'ก'.repeat(300_001) }),
    (error) => error instanceof HttpError && error.status === 413,
  );

  // The editor's own "New post" still gets the site default language.
  const ordinary = await createPost('owner-a', {
    title: 'Ordinary', slug: '', contentJson: { type: 'doc', content: [] }, metaTitle: null, metaDescription: null,
    status: 'draft', categoryIds: [], coverMediaId: null, excerpt: '',
  });
  assert.equal(ordinary.locale, 'th');
});
```

Before running it, check the `media_items` columns against
`tests/integration/published-api-queries.test.ts:41-56`, and copy any required column this fixture is
missing (for example `alt_text` or a `status`). The migration is the source of truth for what is
required.

- [ ] **Step 2: Run it to see it fail**

Run: `node scripts/test-foundation.mjs tests/integration/markdown-import.test.ts`
Expected: FAIL, because `markdown-import-post` cannot be found.

- [ ] **Step 3: Let `createPost` take the language of a new post**

In `src/server/content/posts.ts`, inside `createPost`'s `else` branch, replace
`locale = settings.default_locale;` with:

```ts
        // An import names its own language; the editor's "New post" does not, and gets the default.
        locale = input.locale ?? settings.default_locale;
```

`createPostSchema` is unchanged. Its rule that `locale` needs `sourcePostId` still guards the public
route, and the import calls `createPost` directly.

- [ ] **Step 4: Write the service**

```ts
// src/server/content/markdown-import-post.ts
import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { MAX_MARKDOWN_BYTES, type ImportPicture, type ImportWarning } from '../../lib/markdown-import';
import { contentSlug } from '../../lib/slug';
import type { Post } from '../../types/cms';
import { db } from '../db/client';
import { HttpError } from '../http/errors';
import { parseMarkdownPost, placePictures, type ParsedMarkdownPost } from './markdown-import';
import { createPost } from './posts';

export const markdownImportSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  text: z.string(),
  /** The address as the file writes it, to the id of a picture already uploaded for it. */
  pictures: z.record(z.string().min(1).max(4096), z.uuid()).optional()
    .refine((pictures) => !pictures || Object.keys(pictures).length <= 500, 'Too many pictures.'),
}).strict();

export type MarkdownImportInput = z.infer<typeof markdownImportSchema>;

export interface MarkdownImportPreview {
  title: string;
  /** What the post's address will be; '' when it is made from the id, as for a Thai-less title. */
  slug: string;
  locale: 'th' | 'en';
  /** The site's names of the categories the file matched. */
  categories: string[];
  pictures: ImportPicture[];
  warnings: ImportWarning[];
}

interface Resolved {
  parsed: ParsedMarkdownPost;
  locale: 'th' | 'en';
  categories: { id: string; name: string }[];
  slug: string;
  warnings: ImportWarning[];
}

async function resolve(ownerId: string, input: MarkdownImportInput): Promise<Resolved> {
  if (new TextEncoder().encode(input.text).byteLength > MAX_MARKDOWN_BYTES) throw new HttpError(413, 'The file is too large.');
  const parsed = parseMarkdownPost(input.text, input.fileName);
  const settings = await db.selectFrom('site_settings').select('default_locale')
    .where('id', '=', true).where('owner_id', '=', ownerId).executeTakeFirst();
  if (!settings) throw new HttpError(503, 'Site settings are unavailable.');
  const locale = parsed.locale ?? settings.default_locale;

  const rows = await db.selectFrom('categories').select(['id', 'name']).where('owner_id', '=', ownerId).execute();
  const byName = new Map(rows.map((row) => [row.name.toLowerCase(), row]));
  const categories = [...new Map(parsed.categoryNames
    .map((name) => byName.get(name.toLowerCase()))
    .filter((row): row is { id: string; name: string } => Boolean(row))
    .map((row) => [row.id, row])).values()];
  const missing = parsed.categoryNames.filter((name) => !byName.has(name.toLowerCase()));
  const warnings = [...parsed.warnings];
  if (missing.length) warnings.push({ code: 'category-missing', names: missing });

  let slug = contentSlug(parsed.slug || parsed.title);
  if (slug) {
    const taken = await db.selectFrom('posts').select('id').where('locale', '=', locale).where('slug', '=', slug).executeTakeFirst();
    if (taken) {
      slug = `${slug.slice(0, 151).replace(/-+$/, '')}-${randomUUID().slice(0, 8)}`;
      warnings.push({ code: 'slug-changed', slug });
    }
  }
  return { parsed, locale, categories, slug, warnings };
}

/** What an import of this file would make. Nothing is saved. */
export async function previewMarkdownImport(ownerId: string, input: MarkdownImportInput): Promise<MarkdownImportPreview> {
  const { parsed, locale, categories, slug, warnings } = await resolve(ownerId, input);
  return { title: parsed.title, slug, locale, categories: categories.map(({ name }) => name), pictures: parsed.pictures, warnings };
}

/**
 * Makes the draft. The file is parsed again rather than kept from the preview: it takes well under a
 * tenth of a second, and nothing has to live between the two calls. The pictures were uploaded by
 * the sheet; `createPost` checks each is a ready picture of this owner.
 */
export async function importMarkdownPost(ownerId: string, input: MarkdownImportInput): Promise<{ post: Post; warnings: ImportWarning[] }> {
  const { parsed, locale, categories, slug, warnings } = await resolve(ownerId, input);
  const matches = new Map(Object.entries(input.pictures ?? {}));
  const post = await createPost(ownerId, {
    title: parsed.title,
    slug,
    contentJson: placePictures(parsed.document, matches, locale),
    metaTitle: parsed.metaTitle,
    metaDescription: parsed.metaDescription,
    status: 'draft',
    publishedAt: parsed.publishedAt,
    categoryIds: categories.map(({ id }) => id),
    coverMediaId: parsed.cover ? matches.get(parsed.cover.src) ?? null : null,
    excerpt: parsed.excerpt,
    locale,
  });
  return { post, warnings };
}
```

- [ ] **Step 5: Write the two routes**

```ts
// src/pages/api/admin/posts/import/preview.ts
import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';

import { assertSameOrigin } from '../../../../../server/auth/origin';
import { requireInstalledOwner } from '../../../../../server/auth/session';
import { markdownImportSchema, previewMarkdownImport } from '../../../../../server/content/markdown-import-post';
import { getServerEnv } from '../../../../../server/env';
import { adminErrorResponse, HttpError } from '../../../../../server/http/errors';
import { parseJson } from '../../../../../server/http/json';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;

// What an import would make, and nothing saved: the sheet shows it before any picture is uploaded.
export const POST: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    try {
      assertSameOrigin(request, configuredOrigin);
    } catch {
      throw new HttpError(403, 'Request origin is not allowed.');
    }
    const preview = await previewMarkdownImport(current.user.id, await parseJson(request, markdownImportSchema));
    return Response.json({ preview }, { headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId } });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
```

```ts
// src/pages/api/admin/posts/import/index.ts
import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';

import { assertSameOrigin } from '../../../../../server/auth/origin';
import { requireInstalledOwner } from '../../../../../server/auth/session';
import { importMarkdownPost, markdownImportSchema } from '../../../../../server/content/markdown-import-post';
import { getServerEnv } from '../../../../../server/env';
import { adminErrorResponse, HttpError } from '../../../../../server/http/errors';
import { parseJson } from '../../../../../server/http/json';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;

export const POST: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    try {
      assertSameOrigin(request, configuredOrigin);
    } catch {
      throw new HttpError(403, 'Request origin is not allowed.');
    }
    const result = await importMarkdownPost(current.user.id, await parseJson(request, markdownImportSchema));
    return Response.json(result, { headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId }, status: 201 });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
```

Check that Astro routes `src/pages/api/admin/posts/import/index.ts` to `/api/admin/posts/import`.
The existing `src/pages/api/admin/posts/index.ts` is `/api/admin/posts`, so the new folder does not
collide with it.

- [ ] **Step 6: Run the integration test to see it pass**

Run: `node scripts/test-foundation.mjs tests/integration/markdown-import.test.ts`
Expected: PASS. If the test ports 55432/59000 are busy because another session is running tests,
wait and re-run. It is not a failure.

- [ ] **Step 7: Run the checks**

Run: `npm run check && npm run test:unit`
Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add src/server/content/posts.ts src/server/content/markdown-import-post.ts src/pages/api/admin/posts/import/preview.ts src/pages/api/admin/posts/import/index.ts tests/integration/markdown-import.test.ts
```

Message: `feat: preview and import a Markdown file as a draft`. Then run `git commit -F` on its own.

---

### Task 4: The import sheet, its copy, the docs and the e2e flow

**Files:**
- Modify: `src/lib/admin-i18n.ts` (a `markdownImport` block in `en` near line 678 and in `th` near
  line 1658)
- Create: `src/components/admin/MarkdownImport.tsx`
- Modify: `src/pages/admin/index.astro:128-131` (the island beside "New post")
- Modify: `website/src/content/docs/admin/writing.md` and `website/src/content/docs/th/admin/writing.md`
  (a section after "Starting a post" / "เริ่มบทความใหม่")
- Modify: `docs/specs/2026-09-30-markdown-import-design.md` (the differences listed at the top of
  this plan)
- Test: `tests/e2e/markdown-import.spec.ts`

**Interfaces:**
- Consumes:
  - Task 1: `describePicture`, `matchFiles`, `needsFile`, `pictureLabel`, `MAX_MARKDOWN_BYTES`,
    `MISSING_IMAGE`, `ImportPicture`, `ImportWarning`;
  - Task 3: the two routes and their response shapes;
  - `uploadImage(file: File): Promise<MediaAsset>` from `src/lib/media-client.ts`;
  - `fill` from `src/lib/admin-i18n.ts`.
- Produces: `<MarkdownImport text={copy.markdownImport} editHref="/admin/edit/__ID__" />`.

- [ ] **Step 1: Add the copy**

In `src/lib/admin-i18n.ts`, add to `en` (beside `posts:`):

```ts
  markdownImport: {
    open: 'Import Markdown',
    title: 'Import a post from Markdown',
    chooseFile: 'Choose a .md file',
    chooseHint: 'One file makes one draft. Nothing is published.',
    tooLarge: 'This file is larger than 900 KB.',
    failed: 'This did not work. Try again.',
    picturesHeading: 'Pictures',
    picturesHint: 'Choose the picture files, several at once if you like. Each is matched to the post by its file name.',
    choosePictures: 'Choose pictures',
    cover: 'Cover',
    remote: 'From another site, kept as it is',
    needsFile: 'Needs a file',
    matched: 'Matched with {name}',
    refused: 'Cannot be used, and will be skipped',
    skipped: 'Skipped',
    pickOne: 'Choose file',
    skip: 'Skip',
    undoSkip: 'Undo',
    stillNeeded: 'Choose or skip every picture that needs a file.',
    import: 'Import as draft',
    importing: 'Importing…',
    cancel: 'Cancel',
    uploadedStay: 'Pictures already uploaded stay in the File Manager, where you can delete them.',
    done: 'The draft is ready',
    openDraft: 'Open the draft',
    reportRemote: '{count} pictures are still loaded from other sites.',
    reportSkipped: '{count} pictures were skipped. Search the post for "{label}".',
    reportCategory: 'These categories do not exist: {names}.',
    reportHtml: 'HTML in the file was removed ({count} places).',
    reportLinks: 'Links that led nowhere were removed, and their words kept ({count}).',
    reportTask: 'Checkboxes in a task list became an ordinary list.',
    reportStatus: 'The file asked to publish. The post is a draft.',
    reportDate: 'The date in the file could not be read, and was left out.',
    reportFrontmatter: 'The settings at the top of the file could not be read. Only its text came in.',
    reportSlug: 'That address was taken, so the post is at {slug}.',
  },
```

and to `th`:

```ts
  markdownImport: {
    open: 'นำเข้า Markdown',
    title: 'นำเข้าบทความจาก Markdown',
    chooseFile: 'เลือกไฟล์ .md',
    chooseHint: 'หนึ่งไฟล์ได้หนึ่งฉบับร่าง ยังไม่มีอะไรเผยแพร่',
    tooLarge: 'ไฟล์นี้ใหญ่เกิน 900 KB',
    failed: 'ทำไม่สำเร็จ ลองอีกครั้ง',
    picturesHeading: 'รูปภาพ',
    picturesHint: 'เลือกไฟล์รูป จะเลือกหลายไฟล์พร้อมกันก็ได้ ระบบจับคู่กับรูปในบทความจากชื่อไฟล์',
    choosePictures: 'เลือกรูป',
    cover: 'ภาพปก',
    remote: 'อยู่ที่เว็บอื่น ใช้ตามเดิม',
    needsFile: 'ต้องมีไฟล์',
    matched: 'จับคู่กับ {name} แล้ว',
    refused: 'ใช้ไม่ได้ จะถูกข้าม',
    skipped: 'ข้ามแล้ว',
    pickOne: 'เลือกไฟล์',
    skip: 'ข้าม',
    undoSkip: 'ยกเลิก',
    stillNeeded: 'เลือกไฟล์หรือกดข้ามให้ครบทุกรูปที่ต้องมีไฟล์',
    import: 'นำเข้าเป็นฉบับร่าง',
    importing: 'กำลังนำเข้า…',
    cancel: 'ยกเลิก',
    uploadedStay: 'รูปที่อัปโหลดไปแล้วยังอยู่ในคลังไฟล์ ลบได้จากที่นั่น',
    done: 'ฉบับร่างพร้อมแล้ว',
    openDraft: 'เปิดฉบับร่าง',
    reportRemote: 'มี {count} รูปที่ยังโหลดจากเว็บอื่น',
    reportSkipped: 'ข้ามไป {count} รูป ค้นคำว่า "{label}" ในบทความเพื่อใส่รูปทีหลัง',
    reportCategory: 'ไม่มีหมวดหมู่เหล่านี้ในเว็บ: {names}',
    reportHtml: 'ตัด HTML ในไฟล์ออกแล้ว ({count} จุด)',
    reportLinks: 'ตัดลิงก์ที่ไม่ได้ชี้ไปไหนออก แต่เก็บข้อความไว้ ({count} ลิงก์)',
    reportTask: 'รายการที่มีช่องติ๊กกลายเป็นรายการธรรมดา',
    reportStatus: 'ไฟล์ขอให้เผยแพร่ แต่บทความถูกสร้างเป็นฉบับร่าง',
    reportDate: 'อ่านวันที่ในไฟล์ไม่ได้ จึงไม่ได้ใส่วันที่',
    reportFrontmatter: 'อ่านการตั้งค่าส่วนบนของไฟล์ไม่ได้ นำเข้าเฉพาะเนื้อหา',
    reportSlug: 'ที่อยู่นี้มีบทความใช้แล้ว บทความนี้จึงอยู่ที่ {slug}',
  },
```

`th` is typed `typeof en`, so `npm run check` fails if the two blocks differ in keys.

- [ ] **Step 2: Write the sheet**

```tsx
// src/components/admin/MarkdownImport.tsx
import { useRef, useState } from 'react';

import { fill, type AdminCopy } from '../../lib/admin-i18n';
import {
  MAX_MARKDOWN_BYTES,
  MISSING_IMAGE,
  matchFiles,
  needsFile,
  pictureLabel,
  type ImportPicture,
  type ImportWarning,
} from '../../lib/markdown-import';
import { uploadImage } from '../../lib/media-client';
import type { Post } from '../../types/cms';

type Text = AdminCopy['markdownImport'];
interface Preview { title: string; slug: string; locale: 'th' | 'en'; categories: string[]; pictures: ImportPicture[]; warnings: ImportWarning[] }
interface Source { fileName: string; text: string }

async function send<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof payload === 'object' && payload && 'error' in payload ? String(payload.error) : 'failed');
  return payload as T;
}

function warningLine(text: Text, warning: ImportWarning): string {
  switch (warning.code) {
    case 'frontmatter-unreadable': return text.reportFrontmatter;
    case 'status-ignored': return text.reportStatus;
    case 'date-unreadable': return text.reportDate;
    case 'html-removed': return fill(text.reportHtml, { count: warning.count });
    case 'links-removed': return fill(text.reportLinks, { count: warning.count });
    case 'task-list': return text.reportTask;
    case 'category-missing': return fill(text.reportCategory, { names: warning.names.join(', ') });
    case 'slug-changed': return fill(text.reportSlug, { slug: warning.slug });
  }
}

/**
 * "Import Markdown" on the post list: choose a file, match its pictures to files, and make a draft.
 * The server reads the file twice, once to show what it holds and once to import it, so nothing
 * lives between the steps but this component's state.
 */
export default function MarkdownImport({ text, editHref }: { text: Text; editHref: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [files, setFiles] = useState<Map<string, File>>(new Map());
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [uploadedAny, setUploadedAny] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ post: Post; report: string[] } | null>(null);

  const reset = () => {
    setSource(null); setPreview(null); setFiles(new Map()); setSkipped(new Set());
    setBusy(false); setUploadedAny(false); setError(''); setResult(null);
  };
  const close = () => { dialog.current?.close(); reset(); };

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    setError('');
    if (file.size > MAX_MARKDOWN_BYTES) { setError(text.tooLarge); return; }
    setBusy(true);
    try {
      const next = { fileName: file.name, text: await file.text() };
      const { preview: read } = await send<{ preview: Preview }>('/api/admin/posts/import/preview', next);
      setSource(next);
      setPreview(read);
    } catch {
      setError(text.failed);
    } finally {
      setBusy(false);
    }
  }

  const pictures = preview?.pictures ?? [];
  const waiting = pictures.filter((picture) => needsFile(picture) && !files.has(picture.src) && !skipped.has(picture.src));

  async function runImport() {
    if (!source || !preview || waiting.length) return;
    setBusy(true);
    setError('');
    try {
      // One upload per file, however many pictures it fills.
      const uploaded = new Map<File, string>();
      for (const file of new Set(files.values())) {
        uploaded.set(file, (await uploadImage(file)).id);
        setUploadedAny(true);
      }
      const matches = Object.fromEntries([...files].map(([src, file]) => [src, uploaded.get(file)!]));
      const { post, warnings } = await send<{ post: Post; warnings: ImportWarning[] }>('/api/admin/posts/import', { ...source, pictures: matches });
      const remote = pictures.filter((picture) => picture.kind === 'remote' && picture.where === 'body' && !files.has(picture.src)).length;
      const missing = pictures.filter((picture) => !files.has(picture.src) && (needsFile(picture) || picture.kind === 'refused')).length;
      const report = [
        ...(remote ? [fill(text.reportRemote, { count: remote })] : []),
        ...(missing ? [fill(text.reportSkipped, { count: missing, label: MISSING_IMAGE[preview.locale] })] : []),
        ...warnings.map((warning) => warningLine(text, warning)),
      ];
      setResult({ post, report });
    } catch {
      setError(text.failed);
    } finally {
      setBusy(false);
    }
  }

  function status(picture: ImportPicture): string {
    const file = files.get(picture.src);
    if (file) return fill(text.matched, { name: file.name });
    if (picture.kind === 'refused') return text.refused;
    if (skipped.has(picture.src)) return text.skipped;
    return needsFile(picture) ? text.needsFile : text.remote;
  }

  return (
    <>
      <button className="admin-button admin-button--secondary" type="button" onClick={() => dialog.current?.showModal()}>{text.open}</button>
      <dialog ref={dialog} aria-labelledby="markdown-import-title" className="media-upload-dialog" onCancel={(event) => { if (busy) event.preventDefault(); else reset(); }}>
        <h2 id="markdown-import-title">{result ? text.done : text.title}</h2>
        {result ? (
          <>
            {result.report.length > 0 && <ul>{result.report.map((line) => <li key={line}>{line}</li>)}</ul>}
            <a className="admin-button admin-button--primary" href={editHref.replace('__ID__', result.post.id)}>{text.openDraft}</a>
          </>
        ) : !preview ? (
          <>
            <p>{text.chooseHint}</p>
            <label className="admin-button admin-button--primary">
              {text.chooseFile}
              <input type="file" accept=".md,.markdown,text/markdown" hidden disabled={busy} data-testid="markdown-file"
                onChange={(event) => { void chooseFile(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} />
            </label>
          </>
        ) : (
          <>
            <p><strong>{preview.title}</strong></p>
            {pictures.length > 0 && (
              <section aria-labelledby="markdown-import-pictures">
                <h3 id="markdown-import-pictures">{text.picturesHeading}</h3>
                <p>{text.picturesHint}</p>
                <label className="admin-button admin-button--secondary">
                  {text.choosePictures}
                  <input type="file" accept="image/*" multiple hidden data-testid="markdown-pictures"
                    onChange={(event) => { setFiles((current) => matchFiles(pictures, [...(event.currentTarget.files ?? [])], current)); event.currentTarget.value = ''; }} />
                </label>
                <ul>
                  {pictures.map((picture) => (
                    <li key={`${picture.where}:${picture.src}`}>
                      <span>{picture.where === 'cover' ? `${text.cover}: ` : ''}{pictureLabel(picture)}</span>
                      {' — '}<span>{status(picture)}</span>
                      {needsFile(picture) && !files.has(picture.src) && (skipped.has(picture.src) ? (
                        <button type="button" className="admin-button admin-button--ghost" onClick={() => setSkipped((current) => { const next = new Set(current); next.delete(picture.src); return next; })}>{text.undoSkip}</button>
                      ) : (
                        <>
                          <label className="admin-button admin-button--ghost">
                            {text.pickOne}
                            <input type="file" accept="image/*" hidden onChange={(event) => {
                              const file = event.currentTarget.files?.[0];
                              if (file) setFiles((current) => new Map(current).set(picture.src, file));
                            }} />
                          </label>
                          <button type="button" className="admin-button admin-button--ghost" onClick={() => setSkipped((current) => new Set(current).add(picture.src))}>{text.skip}</button>
                        </>
                      ))}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {waiting.length > 0 && <p>{text.stillNeeded}</p>}
            <button type="button" className="admin-button admin-button--primary" disabled={busy || waiting.length > 0} onClick={() => void runImport()}>
              {busy ? text.importing : text.import}
            </button>
          </>
        )}
        {error && <p role="alert">{error}</p>}
        {!result && (
          <p>
            {uploadedAny && <span>{text.uploadedStay} </span>}
            <button type="button" className="admin-button admin-button--ghost" disabled={busy} onClick={close}>{text.cancel}</button>
          </p>
        )}
      </dialog>
    </>
  );
}
```

`admin-button--ghost`, `--secondary` and `--primary` are existing classes. Do not add CSS. The sheet borrows `media-upload-dialog` for its frame, and the e2e screenshots at
390 px and 1440 px are how its look gets judged.

- [ ] **Step 3: Put it on the post list**

In `src/pages/admin/index.astro`, add
`import MarkdownImport from '../../components/admin/MarkdownImport';` to the imports. Then, inside
`<div class="admin-page__actions">`, before the "Manage categories" link, add:

```astro
          <MarkdownImport client:idle text={copy.markdownImport} editHref={adminHref(adminSettings, '/edit/__ID__')} />
```

Only `copy.markdownImport` goes to the island, not all of `copy`, to keep what the page serializes
small.

- [ ] **Step 4: Write the e2e flow**

Create `tests/e2e/markdown-import.spec.ts`:
1. Copy lines 1–122 of `tests/e2e/admin-150.spec.ts` as they are: the docker stack, `freePort`,
   `beforeAll`, `afterAll` and `signIn`. Change `stack` to `'markdown-import'`, `PROJECT` to
   `'tomecms-md-import-test'`, and `CREDENTIAL` to `'markdown-import-secret-at-least-32-chars-x'`,
   and fix the header comment.
2. Add one test that signs in once, which keeps the file under the limit of five `/recovery`
   sign-ins per file, and runs at both widths:

```ts
// A 1×1 PNG: the library checks that an upload really is the picture it says.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const FILE = [
  '---', 'title: Imported from Markdown', 'locale: en', '---', '',
  '![one](./images/one.png)', '', 'Words between.', '', '![one again](./images/one.png)', '',
  '![two](two.png)', '', '![three](./three.png)', '',
].join('\n');

test('a Markdown file with pictures becomes a draft, a skipped picture leaves a line, at phone and desktop widths', async ({ context, page }) => {
  await signIn(context, page);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${origin}/admin`);
    await page.getByRole('button', { name: 'Import Markdown' }).click();
    await page.getByTestId('markdown-file').setInputFiles({ name: `post-${width}.md`, mimeType: 'text/markdown', buffer: Buffer.from(FILE) });
    await expect(page.getByText('Imported from Markdown')).toBeVisible();
    await page.getByTestId('markdown-pictures').setInputFiles([
      { name: 'one.png', mimeType: 'image/png', buffer: PNG },
      { name: 'TWO.png', mimeType: 'image/png', buffer: PNG },
    ]);
    await expect(page.getByRole('button', { name: 'Import as draft' })).toBeDisabled();
    await page.getByRole('button', { name: 'Skip' }).click();
    await page.screenshot({ path: test.info().outputPath(`sheet-${width}.png`) });
    await page.getByRole('button', { name: 'Import as draft' }).click();
    await expect(page.getByText('1 pictures were skipped. Search the post for "Missing image".')).toBeVisible();
    await page.getByRole('link', { name: 'Open the draft' }).click();
    const editor = page.locator('.ProseMirror');
    await expect(editor.locator('img[src^="/media/"]')).toHaveCount(3);
    await expect(editor).toContainText('[Missing image: three.png]');
  }
});
```

`origin` is the variable the copied `beforeAll` sets. If the copied block names it differently, use
that name. There are three `img` elements: one's picture twice, then two's.

- [ ] **Step 5: Run the e2e test**

Run: `npm run test:e2e -- tests/e2e/markdown-import.spec.ts`
Expected: PASS. Open `sheet-390.png` and `sheet-1440.png` from `test-results/` and check:
- nothing overflows at 390 px;
- the buttons are reachable;
- the list of pictures reads clearly.

If it looks broken, fix it with existing classes before going on.

- [ ] **Step 6: Document it**

In `website/src/content/docs/admin/writing.md`, after the "Starting a post" section, add:

```md
## Importing from Markdown

"Import Markdown", beside "New post", turns one `.md` file into one draft. Nothing is published.

The settings at the top of the file, between two `---` lines, fill the post: `title`, `slug`, `locale` (`th` or `en`), `date`, `categories`, `excerpt` or `description`, `meta_title`, `meta_description`, and `cover`. Each is optional. Without a `title`, the first level 1 heading is the title, then the file name. A category is matched to one of yours by its name; one you do not have is named in the report and not created.

The server does not download pictures. After you choose the file, the sheet lists every picture in it:

- A picture from another site's address stays loaded from that site.
- A picture from your computer needs its file. Choose the picture files, several at once if you like, and each is matched to the post by its file name. You can also choose a file for one picture, or skip it.
- A skipped picture becomes a line such as `[Missing image: photo.png]` where it was. Search the draft for it to put the picture in later.

Some things in a Markdown file have no place in a post and are left out, with a note in the report: HTML, footnotes, and the checkboxes of a task list. Headings deeper than level 3 become level 3.
```

In `website/src/content/docs/th/admin/writing.md`, after "เริ่มบทความใหม่", add the Thai version:

```md
## นำเข้าจาก Markdown

ปุ่ม "นำเข้า Markdown" ข้าง "บทความใหม่" เปลี่ยนไฟล์ `.md` หนึ่งไฟล์เป็นฉบับร่างหนึ่งบทความ ยังไม่มีอะไรเผยแพร่

การตั้งค่าส่วนบนของไฟล์ที่อยู่ระหว่างเส้น `---` สองเส้นจะใช้กรอกข้อมูลบทความ ได้แก่ `title`, `slug`, `locale` (`th` หรือ `en`), `date`, `categories`, `excerpt` หรือ `description`, `meta_title`, `meta_description` และ `cover` ไม่ต้องมีครบทุกตัว ถ้าไม่มี `title` ระบบใช้หัวข้อระดับ 1 ตัวแรก ถ้าไม่มีอีกก็ใช้ชื่อไฟล์ หมวดหมู่จับคู่กับหมวดที่มีอยู่จากชื่อ ถ้าไม่มีหมวดนั้น รายงานจะบอก และระบบไม่สร้างหมวดใหม่ให้

เซิร์ฟเวอร์ไม่ดาวน์โหลดรูปเอง หลังเลือกไฟล์ หน้าต่างจะแสดงรูปทั้งหมดในไฟล์

- รูปที่ลิงก์ไปเว็บอื่นยังโหลดจากเว็บนั้นตามเดิม
- รูปจากเครื่องของคุณต้องมีไฟล์ เลือกไฟล์รูปได้ทีละหลายไฟล์ ระบบจับคู่กับรูปในบทความจากชื่อไฟล์ จะเลือกไฟล์ให้ทีละรูปหรือกดข้ามก็ได้
- รูปที่ข้ามกลายเป็นข้อความ เช่น `[รูปที่ขาด: photo.png]` ตรงตำแหน่งเดิม ค้นคำนี้ในฉบับร่างเพื่อใส่รูปทีหลัง

บางอย่างในไฟล์ Markdown ใส่ในบทความไม่ได้ จึงถูกตัดออกและแจ้งในรายงาน ได้แก่ HTML เชิงอรรถ และช่องติ๊กของรายการ หัวข้อที่ลึกกว่าระดับ 3 จะกลายเป็นระดับ 3
```

- [ ] **Step 7: Bring the spec in line**

In `docs/specs/2026-09-30-markdown-import-design.md`, apply each item of "Where the plan differs from
the spec" at the top of this plan:
- step 3 of "The screen": the report shows in the sheet with "Open the draft";
- "The file" and "The server": 900 KB;
- the spike table's last row: every empty top-level paragraph;
- "The file" table, `slug` row: add the taken-slug suffix and its warning;
- "The server", the dependency line: remove the `check:inventory` sentence.

- [ ] **Step 8: Run everything**

Run: `npm run check && npm run test:unit && (cd website && npm run check && npm run build)`
Expected: all pass. Then run `node scripts/test-foundation.mjs tests/integration/markdown-import.test.ts`
once more.

- [ ] **Step 9: Commit**

```bash
git add src/lib/admin-i18n.ts src/components/admin/MarkdownImport.tsx src/pages/admin/index.astro website/src/content/docs/admin/writing.md website/src/content/docs/th/admin/writing.md docs/specs/2026-09-30-markdown-import-design.md tests/e2e/markdown-import.spec.ts
```

Message: `feat: import a post from a Markdown file on the post list`. Then run `git commit -F` on its
own.

---

## After the plan

The release steps (version, CHANGELOG, release notes, the docs' version references) follow the usual
release flow and are not tasks here. The first real run is on daedalus, with a post exported from
another tool.
