import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { adminCopy } from '../../src/lib/admin-i18n';

import {
  editorContentInputSchema,
  hasMeaningfulContent,
  hasMeaningfulHtml,
  MAX_DOCUMENT_BYTES,
} from '../../src/lib/editor-content';
import { editorMediaIds, prepareEditorContent, ValidationError } from '../../src/server/content/editor';
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
  assert.match(prepared.contentHtml, /<img src="https:\/\/example\.com\/image\.webp" alt="Example" \/>/);
  assert.match(prepared.contentHtml, new RegExp(`<img src="/media/${mediaId}" alt="Stored image" \\/>`));
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
