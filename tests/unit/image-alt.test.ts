import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { withLibraryAlts } from '../../src/lib/editor-content';
import { pictureAttrs } from '../../src/lib/media';
import type { MediaAsset } from '../../src/types/cms';

const ID = '3f11698c-db7e-4724-a236-66808f9b26fe';
const asset = (alt_text: string | null) => ({ alt_text, id: ID, original_name: 'vs-headless-th.webp', publicUrl: `/media/${ID}` }) as MediaAsset;

test('a picture put in a body is described by its alt text, and is decoration without one, never its file name', () => {
  assert.equal(pictureAttrs(asset('A comparison table')).alt, 'A comparison table');
  assert.equal(pictureAttrs(asset(null)).alt, '');
  assert.equal(pictureAttrs(asset('')).alt, '');
  assert.equal(pictureAttrs(asset(null)).title, 'vs-headless-th.webp', 'the editor still shows which file it is');
});

const stored = (alt: string, id = ID) => `<p><img src="/media/${id}" alt="${alt}" decoding="async" loading="lazy" /></p>`;

test('a picture saved with its file name for alt is described by what the library now says, or by nothing', () => {
  assert.equal(withLibraryAlts(stored('vs-headless-th.webp'), [{ alt_text: 'A comparison table', id: ID, original_name: 'vs-headless-th.webp' }]), stored('A comparison table'));
  assert.equal(withLibraryAlts(stored('vs-headless-th.webp'), [{ alt_text: null, id: ID, original_name: 'vs-headless-th.webp' }]), stored(''));
});

test('alt text someone wrote, a picture from elsewhere, and an escaped name are each handled as they are', () => {
  const media = [{ alt_text: 'Library words', id: ID, original_name: 'Tom & Jerry.png' }];
  assert.equal(withLibraryAlts(stored('Written by the author'), media), stored('Written by the author'));
  assert.equal(withLibraryAlts(stored('Tom &amp; Jerry.png'), media), stored('Library words'));
  assert.equal(withLibraryAlts(stored('Tom &amp; Jerry.png', '00000000-0000-4000-8000-000000000000'), media), stored('Tom &amp; Jerry.png', '00000000-0000-4000-8000-000000000000'));
  assert.equal(withLibraryAlts(stored('A &quot;quoted&quot; one'), [{ alt_text: 'A "quoted" one', id: ID, original_name: 'Tom & Jerry.png' }]), stored('A &quot;quoted&quot; one'));
});

test('the alt text put in is escaped as an attribute', () => {
  assert.equal(withLibraryAlts(stored('x.png'), [{ alt_text: 'Say "hi" <b> & go', id: ID, original_name: 'x.png' }]), stored('Say &quot;hi&quot; &lt;b&gt; &amp; go'));
});

test('alt text with a dollar sign is put in as written', () => {
  assert.equal(withLibraryAlts(stored('x.png'), [{ alt_text: 'From $5, $& more', id: ID, original_name: 'x.png' }]), stored('From $5, $&amp; more'));
});

test('both admin draft previews read their content through the helper that describes old pictures', () => {
  const read = (path: string) => readFileSync(new URL(`../../src/pages/admin/${path}`, import.meta.url), 'utf8');
  assert.match(read('preview/[id].astro'), /draftPreviewPost\(/);
  assert.match(read('pages/preview/[id].astro'), /draftPreviewPage\(/);
});
