import assert from 'node:assert/strict';
import test from 'node:test';

import { getSchema } from '@tiptap/core';
import { DOMParser, DOMSerializer, Node } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { createHTMLDocument, parseHTML } from 'zeed-dom';

import { linkWithFile } from '../../src/lib/editor-link';
import { dialogAnswer } from '../../src/lib/ui-dialog';
import { prepareEditorContent, ValidationError } from '../../src/server/content/editor';
import type { EditorDocument } from '../../src/types/cms';

const id = '33333333-3333-4333-8333-333333333333';
const schema = getSchema([StarterKit.configure({ link: false }), linkWithFile]);
const linked = (attrs: Record<string, string | number | null>): EditorDocument => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'the guide', marks: [{ type: 'link', attrs }] }] }],
});

test('a prompt answered with its secondary action says so, and carries the checkbox but no value', () => {
  assert.deepEqual(dialogAnswer(true, true, 'typed and ignored'), { checked: true, secondary: true });
  assert.deepEqual(dialogAnswer(true, false, ''), { checked: false, secondary: true });
  assert.deepEqual(dialogAnswer(false, true, 'https://example.com'), { checked: true, secondary: false, value: 'https://example.com' });
});

test('a link remembers its file through JSON and HTML', () => {
  const document = Node.fromJSON(schema, linked({ href: `/media/${id}`, mediaId: id, target: '_blank' }));
  const fragment = DOMSerializer.fromSchema(schema).serializeFragment(document.content, { document: createHTMLDocument() as unknown as Document });
  const html = (fragment as unknown as { render(): string }).render();
  assert.match(html, new RegExp(`href="/media/${id}"`));
  assert.match(html, new RegExp(`data-media-id="${id}"`));
  const back = DOMParser.fromSchema(schema).parse(parseHTML(html) as unknown as globalThis.Node).toJSON();
  assert.equal(back.content[0].content[0].marks[0].attrs.mediaId, id);
  assert.equal(back.content[0].content[0].marks[0].attrs.href, `/media/${id}`);

  const plain = Node.fromJSON(schema, linked({ href: 'https://example.com' }));
  const plainHtml = (DOMSerializer.fromSchema(schema).serializeFragment(plain.content, { document: createHTMLDocument() as unknown as Document }) as unknown as { render(): string }).render();
  assert.doesNotMatch(plainHtml, /data-media-id/, 'an ordinary link names no file');
});

test('the server keeps the file in the stored JSON and the site-relative address on the page', () => {
  const stored = prepareEditorContent({ contentJson: linked({ href: `/media/${id.toUpperCase()}`, mediaId: id.toUpperCase(), target: '_blank' }) });
  const attrs = stored.contentJson.content?.[0]?.content?.[0]?.marks?.[0]?.attrs;
  assert.equal(attrs?.mediaId, id, 'the reference check reads this');
  assert.equal(attrs?.href, `/media/${id}`);
});

test('a URL typed over a file link saves as an ordinary link: the file it was is let go, not refused', () => {
  // Tiptap merges attributes, so typing a URL over a file link leaves the old mediaId beside the new href.
  const stored = prepareEditorContent({ contentJson: linked({ href: 'https://example.com', mediaId: id, target: '_blank' }) });
  const attrs = stored.contentJson.content?.[0]?.content?.[0]?.marks?.[0]?.attrs;
  assert.equal(attrs?.href, 'https://example.com');
  assert.equal('mediaId' in (attrs ?? {}), false, 'it no longer holds the file');
  assert.match(stored.contentHtml, /<a target="_blank" rel="noopener noreferrer" href="https:\/\/example\.com">the guide<\/a>/);
  // The same for another file's address, and for the typed link that clears it on purpose.
  const other = prepareEditorContent({ contentJson: linked({ href: '/media/44444444-4444-4444-8444-444444444444', mediaId: id }) });
  assert.equal('mediaId' in (other.contentJson.content?.[0]?.content?.[0]?.marks?.[0]?.attrs ?? {}), false);
  assert.doesNotThrow(() => prepareEditorContent({ contentJson: linked({ href: 'https://example.com', mediaId: null }) }));
});

test('a link that names a file keeps it only when it is that file\'s address, and an id that is no id is refused', () => {
  assert.doesNotThrow(() => prepareEditorContent({ contentJson: linked({ href: `/media/${id}`, mediaId: id }) }));
  for (const attrs of [
    { href: `/media/${id}`, mediaId: 'not-a-uuid' },
    { href: `/media/${id}`, mediaId: 7 },
  ]) {
    assert.throws(() => prepareEditorContent({ contentJson: linked(attrs) }), ValidationError, JSON.stringify(attrs));
  }
  const { contentHtml } = prepareEditorContent({ contentJson: linked({ href: `/media/${id}`, mediaId: id, target: '_blank' }) });
  assert.match(contentHtml, new RegExp(`<a target="_blank" rel="noopener noreferrer" href="/media/${id}">the guide</a>`), 'the page keeps a relative link');
});
