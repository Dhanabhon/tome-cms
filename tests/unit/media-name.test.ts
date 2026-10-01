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

test('a name that is only the ending is a name: it takes the ending again, so the type is never lost', () => {
  assert.equal(keepExtension('.webp', 'a.webp'), '.webp.webp');
  assert.equal(keepExtension('.WEBP', 'a.webp'), '.WEBP.webp');
});

test('a stored name that is only an extension has that extension', () => {
  assert.equal(keepExtension('x', '.webp'), 'x.webp');
  assert.equal(keepExtension('x.webp', '.webp'), 'x.webp');
  assert.equal(keepExtension('.webp', '.webp'), '.webp.webp');
});

test('a name ending in a dot does not leave two', () => {
  assert.equal(keepExtension('photo.', 'a.webp'), 'photo.webp');
  assert.equal(keepExtension('photo...', 'a.webp'), 'photo.webp');
  assert.equal(keepExtension('photo. .webp', 'a.webp'), 'photo.webp');
  assert.equal(keepExtension('...', 'a.webp'), '.webp');
});

test('Thai names pass through whole', () => {
  assert.equal(keepExtension('ภาพทะเล', 'a.webp'), 'ภาพทะเล.webp');
});

test('the cut counts characters and never splits a surrogate pair', () => {
  const emoji = '\u{1F600}';
  const cutEmoji = keepExtension(emoji.repeat(300), 'a.webp');
  assert.equal(Array.from(cutEmoji).length, 255);
  assert.ok(cutEmoji.isWellFormed());
  assert.ok(cutEmoji.endsWith(`${emoji}.webp`));
  // Over 255 UTF-16 units but under 255 characters is not cut at all.
  const short = `${emoji.repeat(200)}.webp`;
  assert.equal(keepExtension(short, 'a.webp'), short);
  const thai = keepExtension('ก'.repeat(300), 'a.pdf');
  assert.equal(Array.from(thai).length, 255);
  assert.ok(thai.endsWith('ก.pdf'));
});
