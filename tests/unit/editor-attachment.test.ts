import assert from 'node:assert/strict';
import test from 'node:test';

import { getSchema } from '@tiptap/core';
import { DOMParser, DOMSerializer, Node } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { createHTMLDocument, parseHTML } from 'zeed-dom';

import { attachment } from '../../src/lib/editor-attachment';

const schema = getSchema([StarterKit, attachment]);
const ID = '44444444-4444-4444-8444-444444444444';

/** HTML as the editor's clipboard hands it back: read by the schema's own rules. Its attrs are null-prototype objects, which a strict deepEqual refuses against a literal, so it goes through JSON. */
const parse = (html: string) => JSON.parse(JSON.stringify(DOMParser.fromSchema(schema).parse(parseHTML(html) as unknown as globalThis.Node).toJSON()));

/** A card as the clipboard carries it: the node's own HTML. */
function serialize(attrs: Record<string, unknown>): string {
  const document = Node.fromJSON(schema, { type: 'doc', content: [{ type: 'attachment', attrs }] });
  const fragment = DOMSerializer.fromSchema(schema).serializeFragment(document.content, { document: createHTMLDocument() as unknown as Document });
  return (fragment as unknown as { render(): string }).render();
}

test('a card that goes through the clipboard comes back a card', () => {
  const attrs = { href: `/media/${ID}`, mediaId: ID, mimeType: 'application/pdf', name: 'คู่มือ.pdf', size: 2048 };
  assert.deepEqual(parse(serialize(attrs)).content?.[0], { type: 'attachment', attrs });
});

test('a pasted card is only what its link and name say, whatever else the element carries', () => {
  const pasted = parse(`<p class="file-card" href="javascript:alert(1)" mimetype="text/html" name="x" size="9"><a href="/media/${ID}" type="application/pdf"><span class="file-card__name">Guide.pdf</span></a></p>`);
  assert.deepEqual(pasted.content?.[0], { type: 'attachment', attrs: { href: `/media/${ID}`, mediaId: ID, mimeType: 'application/pdf', name: 'Guide.pdf', size: 0 } });
  const elsewhere = parse('<p class="file-card"><a href="https://elsewhere.example/x.pdf" type="application/pdf">x</a></p>');
  assert.equal(elsewhere.content?.[0]?.type, 'paragraph', 'a link that is not to the library is no card');
  // The link is drawn from the id, whatever href the node was given.
  assert.match(serialize({ href: 'javascript:alert(1)', mediaId: ID, mimeType: 'application/pdf', name: 'x', size: 1 }), new RegExp(`<a href="/media/${ID}"`));
});
