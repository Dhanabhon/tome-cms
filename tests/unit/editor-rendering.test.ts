import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { adminCopy } from '../../src/lib/admin-i18n';

import {
  editorContentInputSchema,
  editorText,
  hasMeaningfulContent,
  hasMeaningfulHtml,
  MAX_DOCUMENT_BYTES,
  sanitizedContentHtmlSchema,
} from '../../src/lib/editor-content';
import { editorFileIds, editorMediaIds, prepareEditorContent, ValidationError } from '../../src/server/content/editor';
import type { EditorDocument, EditorNode } from '../../src/types/cms';

test('server renders, sanitizes, and bounds editor content', () => {
  const mediaId = '11111111-1111-4111-8111-111111111111';
  const contentJson: EditorDocument = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Bold', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' italic', marks: [{ type: 'italic' }] },
          { type: 'text', text: ' code', marks: [{ type: 'code' }] },
          { type: 'text', text: ' link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
        ],
      },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item' }] }] }] },
      { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }] }] },
      { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quote' }] }] },
      { type: 'codeBlock', content: [{ type: 'text', text: 'const x = 1;' }] },
      { type: 'image', attrs: { src: 'https://example.com/image.webp', alt: 'Example' } },
      { type: 'image', attrs: { src: `/media/${mediaId}`, alt: 'Stored image' } },
    ],
  };

  const prepared = prepareEditorContent({ contentJson });
  assert.match(prepared.contentHtml, /^<h1>Title<\/h1><p><strong>Bold<\/strong><em> italic<\/em>/);
  assert.match(prepared.contentHtml, /<code[^>]*> code<\/code>/);
  assert.match(prepared.contentHtml, /<a[^>]*href="https:\/\/example\.com"[^>]*> link<\/a>/);
  assert.match(prepared.contentHtml, /<ul><li><p>Item<\/p><\/li><\/ul>/);
  assert.match(prepared.contentHtml, /<ol><li><p>First<\/p><\/li><\/ol>/);
  assert.match(prepared.contentHtml, /<blockquote><p>Quote<\/p><\/blockquote>/);
  assert.match(prepared.contentHtml, /<pre><code>const x = 1;<\/code><\/pre>/);
  // Every image in an article loads as it nears the window, and decodes off the main thread.
  assert.match(prepared.contentHtml, /<img src="https:\/\/example\.com\/image\.webp" alt="Example" decoding="async" loading="lazy" \/>/);
  assert.match(prepared.contentHtml, new RegExp(`<img src="/media/${mediaId}" alt="Stored image" decoding="async" loading="lazy" \\/>`));
  assert.deepEqual(editorMediaIds(prepared.contentJson), [mediaId]);
  assert.equal(prepared.contentJson.content?.at(-1)?.attrs?.mediaId, mediaId);
  assert.equal(prepareEditorContent({ contentJson }).contentHtml, prepared.contentHtml);

  const unsafe = prepareEditorContent({
    contentJson: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { onclick: 'alert(1)' },
          content: [{ type: 'text', text: 'Unsafe', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)', onmouseover: 'alert(1)' } }] }],
        },
      ],
    },
  });
  assert.doesNotMatch(unsafe.contentHtml, /javascript:|onclick|onerror|onmouseover/i);
  assert.throws(() => prepareEditorContent({
    contentJson: { type: 'doc', content: [{ type: 'image', attrs: { src: 'javascript:alert(1)' } }] },
  }), ValidationError);
  assert.throws(() => prepareEditorContent({
    contentJson: { type: 'doc', content: [{ type: 'image', attrs: { mediaId: crypto.randomUUID(), src: `/media/${mediaId}` } }] },
  }), ValidationError);
  assert.throws(
    () => prepareEditorContent({ contentJson: { type: 'doc', content: [{ type: 'unsupported' }] } }),
    ValidationError,
  );
  assert.equal(editorContentInputSchema.safeParse({ contentJson, contentHtml: '<script>alert(1)</script>' }).success, false);

  let nested: EditorNode = { type: 'paragraph' };
  for (let index = 0; index < 101; index += 1) nested = { type: 'blockquote', content: [nested] };
  assert.throws(() => prepareEditorContent({ contentJson: { type: 'doc', content: [nested] } }), ValidationError);
  assert.throws(
    () => prepareEditorContent({ contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(MAX_DOCUMENT_BYTES) }] }] } }),
    ValidationError,
  );

  const empty = prepareEditorContent({ contentJson: { type: 'doc', content: [{ type: 'paragraph' }] } });
  assert.equal(hasMeaningfulContent(empty.contentJson), false);
  assert.equal(hasMeaningfulHtml(empty.contentHtml), false);
});

test('a link opens a new tab only when its writer asked it to', () => {
  const link = (text: string, target: string | null): EditorNode => ({
    type: 'text', text, marks: [{ type: 'link', attrs: { href: 'https://example.com', target } }],
  });
  const { contentHtml } = prepareEditorContent({
    contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [link('Elsewhere', '_blank'), link(' Here', null)] }] },
  });
  assert.match(contentHtml, /<a target="_blank" rel="noopener noreferrer" href="https:\/\/example\.com">Elsewhere<\/a>/);
  assert.match(contentHtml, /<a rel="noopener noreferrer" href="https:\/\/example\.com"> Here<\/a>/, 'no target, so the same tab');
});

test('a line keeps its alignment, and no other style', () => {
  const line = (type: string, text: string, textAlign: string, level?: number): EditorNode => ({
    type, attrs: { textAlign, ...(level ? { level } : {}) }, content: [{ type: 'text', text }],
  });
  const { contentHtml } = prepareEditorContent({
    contentJson: { type: 'doc', content: [line('heading', 'Centred', 'center', 2), line('paragraph', 'Right', 'right'), line('paragraph', 'Not justified', 'justify')] },
  });
  assert.match(contentHtml, /<h2 style="text-align:center">Centred<\/h2>/);
  assert.match(contentHtml, /<p style="text-align:right">Right<\/p>/);
  assert.match(contentHtml, /<p>Not justified<\/p>/, 'justify is not one of the three');

  const hostile = sanitizedContentHtmlSchema.parse(
    '<p style="text-align:center;position:fixed;background:url(x)">A</p><p style="text-align:expression(alert(1))">B</p><img src="https://example.com/a.webp" style="position:fixed">',
  );
  assert.equal(hostile, '<p style="text-align:center">A</p><p>B</p><img src="https://example.com/a.webp" decoding="async" loading="lazy" />');
  // Those two, with those values and no others: an image asked to load at once is still lazy.
  assert.equal(
    sanitizedContentHtmlSchema.parse('<img src="https://example.com/a.webp" loading="eager" decoding="sync" fetchpriority="high">'),
    '<img src="https://example.com/a.webp" loading="lazy" decoding="async" />',
  );
});

test('a table is kept whole, and nothing that rides in with it', () => {
  // A cell holds paragraphs, and Enter in a cell starts another one in the same cell.
  const cell = (type: 'tableCell' | 'tableHeader', texts: string[], attrs?: { colspan: number }): EditorNode => ({
    type, ...(attrs ? { attrs } : {}),
    content: texts.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
  });
  const contentJson: EditorDocument = {
    type: 'doc',
    content: [{
      type: 'table',
      content: [
        { type: 'tableRow', content: [cell('tableHeader', ['Name']), cell('tableHeader', ['Age', 'in years'])] },
        { type: 'tableRow', content: [cell('tableCell', ['Alice']), cell('tableCell', ['30'])] },
        { type: 'tableRow', content: [cell('tableCell', ['Across', 'both'], { colspan: 2 })] },
      ],
    }],
  };

  // The wrapper is what lets a wide table scroll inside itself instead of widening the page.
  const { contentHtml } = prepareEditorContent({ contentJson });
  assert.match(contentHtml, /^<div class="tableWrapper"><table><tbody><tr><th[^>]*><p>Name<\/p><\/th><th[^>]*><p>Age<\/p><p>in years<\/p><\/th><\/tr>/);
  assert.match(contentHtml, /<tr><td[^>]*><p>Alice<\/p><\/td><td[^>]*><p>30<\/p><\/td><\/tr>/);
  assert.match(contentHtml, /<td colspan="2"[^>]*><p>Across<\/p><p>both<\/p><\/td>/, 'a cell pasted across two columns stays across two');
  // Tiptap sizes a table inline, and adds a colgroup for dragging column widths, which this
  // editor does not offer. Neither is anything a theme should have to fight.
  assert.doesNotMatch(contentHtml, /style=|<colgroup|<col\b/);

  const hostile = sanitizedContentHtmlSchema.parse(
    '<div class="tableWrapper wide" onclick="x"><table style="position:fixed"><tbody>'
    + '<tr><td colspan="2" style="color:red" onmouseover="x" data-x="1">A</td></tr></tbody></table></div>'
    + '<div class="banner">B</div>',
  );
  assert.equal(hostile, '<div class="tableWrapper"><table><tbody><tr><td colspan="2">A</td></tr></tbody></table></div><div>B</div>');

  // Each cell's words stand apart, so they are counted, read and judged as words.
  assert.equal(editorText(contentJson), 'Name Age in years Alice 30 Across both');
});

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as const;

test('a file card says what the library says of its file, and nothing the editor sent', () => {
  const mediaId = '22222222-2222-4222-8222-222222222222';
  const files = new Map([[mediaId, { mimeType: 'application/pdf' as const, name: 'คู่มือการสมัคร.pdf', size: 1_258_291 }]]);
  const card = (attrs: Record<string, string | number>): EditorDocument => ({ type: 'doc', content: [{ type: 'attachment', attrs }] });
  const { contentHtml, contentJson } = prepareEditorContent({
    contentJson: card({ href: 'https://elsewhere.example/x', mediaId: mediaId.toUpperCase(), mimeType: 'application/zip', name: 'lie.zip', size: 1 }),
  }, files);
  assert.deepEqual(contentJson.content?.[0]?.attrs,
    { href: `/media/${mediaId}`, mediaId, mimeType: 'application/pdf', name: 'คู่มือการสมัคร.pdf', size: 1_258_291 });
  assert.match(contentHtml,
    /^<p class="file-card"><a [^>]*><span class="file-card__name">คู่มือการสมัคร\.pdf<\/span> <span class="file-card__meta">PDF · 1\.2 MB<\/span><\/a><\/p>$/);
  assert.match(contentHtml, new RegExp(`<a [^>]*href="/media/${mediaId}"`));
  assert.match(contentHtml, /<a [^>]*type="application\/pdf"/);
  assert.match(contentHtml, /<a [^>]*target="_blank"/, 'a PDF opens in a tab of its own');
  assert.equal(contentHtml, `<p class="file-card"><a href="/media/${mediaId}" type="application/pdf" target="_blank" rel="noopener noreferrer"><span class="file-card__name">คู่มือการสมัคร.pdf</span> <span class="file-card__meta">PDF · 1.2 MB</span></a></p>`);
  assert.doesNotMatch(contentHtml, /data-|elsewhere|lie\.zip/, "what the editor sent, and the clipboard's attributes, are not kept");
  assert.equal(editorText(contentJson), '', "a card's name is not among the article's words");
  assert.equal(hasMeaningfulContent(contentJson), true, 'a card alone is content');

  const docxId = '33333333-3333-4333-8333-333333333333';
  const docx = prepareEditorContent({ contentJson: card({ mediaId: docxId }) },
    new Map([[docxId, { mimeType: DOCX, name: '<b>Plan</b>.docx', size: 84 * 1024 }]]));
  assert.doesNotMatch(docx.contentHtml, /target=/, 'anything but a PDF downloads where it is');
  assert.match(docx.contentHtml, /&lt;b&gt;Plan&lt;\/b&gt;\.docx/, 'a name is text, never markup');
  assert.match(docx.contentHtml, /DOCX · 84 KB/);
  assert.equal(docx.contentHtml, `<p class="file-card"><a href="/media/${docxId}" type="application/vnd.openxmlformats-officedocument.wordprocessingml.document" rel="noopener noreferrer"><span class="file-card__name">&lt;b&gt;Plan&lt;/b&gt;.docx</span> <span class="file-card__meta">DOCX · 84 KB</span></a></p>`);
  assert.throws(() => prepareEditorContent({ contentJson: card({ mediaId }) }), ValidationError, 'a card for a file the library does not have');
  assert.deepEqual(editorFileIds(card({ mediaId: mediaId.toUpperCase() })), [mediaId]);
  assert.deepEqual(editorFileIds(card({ mediaId: 'not-a-uuid' })), [], 'nothing a lookup would choke on');
});

test('a card keeps its parts through the sanitizer, and nothing that rides in with them', () => {
  const html = sanitizedContentHtmlSchema.parse(
    '<p class="file-card intruder" data-media-id="x" onclick="x"><a href="/media/11111111-1111-4111-8111-111111111111" type="application/pdf" data-size="1">'
    + '<span class="file-card__name wide" style="color:red">A</span> <span class="file-card__meta">PDF · 1 B</span></a></p><span class="other">B</span>',
  );
  assert.equal(html, '<p class="file-card"><a href="/media/11111111-1111-4111-8111-111111111111" type="application/pdf" rel="noopener noreferrer">'
    + '<span class="file-card__name">A</span> <span class="file-card__meta">PDF · 1 B</span></a></p><span>B</span>');
});

test("an editor refuses to publish an empty document in the owner's own language", () => {
  // The rule above is the API's. Restating it in the editor would let the two drift, so each
  // editor imports the same predicate and answers in the copy the owner is already reading.
  for (const name of ['Editor', 'PageEditor'] as const) {
    const source = readFileSync(new URL(`../../src/components/admin/${name}.tsx`, import.meta.url), 'utf8');
    assert.match(source, /import \{ hasMeaningfulContent \} from '\.\.\/\.\.\/lib\/editor-content';/);
    assert.match(source, /if \(!hasMeaningfulContent\(draftRef\.current\.contentJson\)\) \{\n\s+setErrorMessage\(copy\.editor\.contentRequired\);\n\s+return;/);
    // Nothing reaches the network until the check has passed, and this is the only way through.
    assert.match(source, /setErrorMessage\(copy\.editor\.contentRequired\);[\s\S]*?await (?:atLeast\()?saveBefore\(\(\) => undefined, 'published'\)/);
    assert.equal(source.match(/saveBefore\(\(\) => undefined, 'published'\)/g)?.length, 1);
    assert.match(source, /onClick=\{\(\) => void publish\(\)\}/);
  }
  for (const locale of ['en', 'th'] as const) assert.ok(adminCopy(locale).editor.contentRequired.trim());
});

test('an editor that is refused anyway is refused in the same language', () => {
  // The guard cannot see everything the API checks -- an image whose src the server will not
  // keep passes the editor and fails the API. That refusal comes back coded, and both editors
  // read a coded refusal through the one reader the whole admin shares.
  for (const name of ['Editor', 'PageEditor'] as const) {
    const source = readFileSync(new URL(`../../src/components/admin/${name}.tsx`, import.meta.url), 'utf8');
    assert.match(source, /import \{ adminHref, adminPreviewHref, apiErrorMessage \} from '\.\.\/\.\.\/lib\/admin';/);
    assert.match(source, /apiErrorMessage\(payload, \{ contentRequired: copy\.editor\.contentRequired, failed: copy\.editor\.(post|page)NotSaved \}\)/);
    // Each editor had grown its own reader of the same body.
    assert.doesNotMatch(source, /function readApiError/);
  }
});
