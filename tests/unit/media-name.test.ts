import assert from 'node:assert/strict';
import test from 'node:test';

import { keepExtension } from '../../src/lib/media-name';

test('a new name takes the stored file\'s extension', () => {
  assert.equal(keepExtension('photo', 'a.webp'), 'photo.webp');
});

test('a different extension is part of the name, not a change of type', () => {
  assert.equal(keepExtension('photo.png', 'a.webp'), 'photo.png.webp');
});

test('the extension is compared without regard to case and kept as typed', () => {
  assert.equal(keepExtension('photo.WEBP', 'a.webp'), 'photo.WEBP');
  assert.equal(keepExtension('photo.webp', 'a.WEBP'), 'photo.webp');
});

test('surrounding spaces are dropped', () => {
  assert.equal(keepExtension('  x  ', 'a.pdf'), 'x.pdf');
  assert.equal(keepExtension('  x.pdf  ', 'a.pdf'), 'x.pdf');
});

test('a file with no extension takes the name as given', () => {
  assert.equal(keepExtension('  notes  ', 'README'), 'notes');
  assert.equal(keepExtension('notes', '.hidden'), 'notes');
});

test('a long name is cut with its extension intact', () => {
  const cut = keepExtension('n'.repeat(400), 'a.webp');
  assert.equal(cut.length, 255);
  assert.ok(cut.endsWith('nn.webp'));
  assert.equal(keepExtension(`${'n'.repeat(400)}.webp`, 'a.webp').length, 255);
});

test('a name cut at a space does not end in one', () => {
  const cut = keepExtension(`${'n'.repeat(249)} ${'m'.repeat(10)}`, 'a.webp');
  assert.equal(cut, `${'n'.repeat(249)}.webp`);
});
