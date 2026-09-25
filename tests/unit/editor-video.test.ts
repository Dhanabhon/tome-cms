import assert from 'node:assert/strict';
import test from 'node:test';

import { getSchema } from '@tiptap/core';
import { DOMParser, DOMSerializer, Node } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { createHTMLDocument, parseHTML } from 'zeed-dom';

import { documentHasVideo, video, videoAttrs } from '../../src/lib/editor-video';

const schema = getSchema([StarterKit, video]);
const POSTER = '55555555-5555-4555-8555-555555555555';
const ID = 'dQw4w9WgXcQ';

const parse = (html: string) => JSON.parse(JSON.stringify(DOMParser.fromSchema(schema).parse(parseHTML(html) as unknown as globalThis.Node).toJSON()));

function serialize(attrs: Record<string, unknown>): string {
  const document = Node.fromJSON(schema, { type: 'doc', content: [{ type: 'video', attrs }] });
  const fragment = DOMSerializer.fromSchema(schema).serializeFragment(document.content, { document: createHTMLDocument() as unknown as Document });
  return (fragment as unknown as { render(): string }).render();
}

test('a video that goes through the clipboard comes back the same video', () => {
  for (const attrs of [
    { mediaId: POSTER, provider: 'youtube', start: 30, title: 'A clip worth watching', videoId: ID },
    { mediaId: null, provider: 'vimeo', start: null, title: '', videoId: '76979871' },
  ]) assert.deepEqual(parse(serialize(attrs)).content?.[0], { type: 'video', attrs });
});

test('the HTML is a poster that links to the clip, with no player and no words of the site', () => {
  const html = serialize({ mediaId: POSTER, provider: 'youtube', start: 30, title: 'A clip', videoId: ID });
  assert.match(html, /^<figure class="tome-video"><a class="tome-video__play" href="https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ&(amp;)?t=30">/);
  assert.match(html, new RegExp(`<img alt="" src="/media/${POSTER}">`));
  assert.match(html, /<span class="tome-video__title">A clip<\/span><\/a><figcaption>A clip · YouTube<\/figcaption><\/figure>$/);
  assert.doesNotMatch(html, /iframe|script|data-/);
  const untitled = serialize({ mediaId: null, provider: 'vimeo', start: null, title: '', videoId: '76979871' });
  assert.match(untitled, /<span class="tome-video__title">Vimeo<\/span><\/a><figcaption>Vimeo<\/figcaption>/);
  assert.doesNotMatch(untitled, /<img/);
});

test('a figure that is not one of ours is not a video', () => {
  assert.notEqual(parse('<figure class="tome-video"><a class="tome-video__play" href="https://example.com/x">x</a></figure>').content?.[0]?.type, 'video');
});

test('only a clip of the right shape is a stored video', () => {
  const good = { mediaId: POSTER.toUpperCase(), provider: 'youtube', start: 30, title: '  A clip  ', videoId: ID };
  assert.deepEqual(videoAttrs(good), { mediaId: POSTER, provider: 'youtube', start: 30, title: 'A clip', videoId: ID });
  assert.deepEqual(videoAttrs({ provider: 'vimeo', title: '', videoId: '1' }), { mediaId: null, provider: 'vimeo', start: null, title: '', videoId: '1' });
  for (const bad of [
    null,
    { ...good, provider: 'tiktok' },
    { ...good, videoId: 'short' },
    { ...good, provider: 'vimeo' },
    { ...good, start: 0 },
    { ...good, start: 1.5 },
    { ...good, start: 86_401 },
    { ...good, title: 'x'.repeat(201) },
    { ...good, title: 3 },
    { ...good, mediaId: '/media/x' },
    { ...good, src: 'https://evil.example/x' },
  ]) assert.equal(videoAttrs(bad), null, JSON.stringify(bad));
});

test('a document knows whether it holds a video', () => {
  assert.equal(documentHasVideo({ type: 'doc', content: [{ type: 'paragraph' }] }), false);
  assert.equal(documentHasVideo({ type: 'doc', content: [{ type: 'blockquote', content: [{ type: 'video' }] }] }), true);
});
