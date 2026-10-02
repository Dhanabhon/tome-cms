import assert from 'node:assert/strict';
import { test } from 'node:test';

import { demoteH1, sanitizedContentHtmlSchema } from '../../src/lib/editor-content';

test('a heading one in a body becomes a heading two, aligned or not', () => {
  assert.equal(demoteH1('<h1>Plain</h1><p>x</p>'), '<h2>Plain</h2><p>x</p>');
  // The editor writes an aligned heading with a style, which is the shape a bare tag match misses.
  assert.equal(demoteH1('<h1 style="text-align: center">Aligned</h1>'), '<h2 style="text-align: center">Aligned</h2>');
  assert.equal(demoteH1('<h1>a</h1><h1 style="text-align: right">b</h1>'), '<h2>a</h2><h2 style="text-align: right">b</h2>');
});

test('only a heading one is touched: other tags that start with h1, and the words, stay', () => {
  assert.equal(demoteH1('<h2>Two</h2><h3>Three</h3><p>an h1 in words, and &lt;h1&gt;</p>'), '<h2>Two</h2><h3>Three</h3><p>an h1 in words, and &lt;h1&gt;</p>');
  assert.equal(demoteH1('<h10>x</h10><hr>'), '<h10>x</h10><hr>');
});

test('what the sanitiser keeps of an aligned heading one is demoted too', () => {
  const html = sanitizedContentHtmlSchema.parse('<h1 style="text-align: center">Centred</h1>');
  assert.match(html, /^<h1 style=/, 'the sanitiser keeps the heading and its alignment');
  assert.doesNotMatch(demoteH1(html), /h1/);
});
