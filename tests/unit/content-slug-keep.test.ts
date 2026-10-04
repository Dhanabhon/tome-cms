import assert from 'node:assert/strict';
import test from 'node:test';

import { contentSlug, SLUG_LENGTH } from '../../src/lib/slug';
import { normalizedContentSlug } from '../../src/server/content/mutations';

const ID = '12345678-aaaa-bbbb-cccc-1234567890ab';

test('a valid slug comes back as it was given, so a save never moves an address', () => {
  // The premise: ICU splits this run, which is how a save used to move it.
  assert.equal(contentSlug('สวัสดีครับ'), 'สวัสดี-ครับ');
  assert.equal(normalizedContentSlug('post', 'สวัสดีครับ', 'Hello', ID), 'สวัสดีครับ');
  assert.equal(normalizedContentSlug('page', 'สวัสดีครับ', 'Hello', ID), 'สวัสดีครับ');
  assert.equal(normalizedContentSlug('post', 'hello-world', 'x', ID), 'hello-world');
  assert.equal(normalizedContentSlug('post', ' สวัสดีครับ ', 'x', ID), 'สวัสดีครับ', 'trimmed, then kept');
  assert.equal(normalizedContentSlug('post', 'สวัสดีครับ'.normalize('NFD'), 'x', ID), 'สวัสดีครับ', 'NFC, then kept');
});

test('anything else is still made into one, from the slug, then the title, then the id', () => {
  assert.equal(normalizedContentSlug('post', 'Hello World!', 'x', ID), 'hello-world');
  assert.equal(normalizedContentSlug('post', '', 'Evening bread', ID), 'evening-bread');
  assert.equal(normalizedContentSlug('post', '', '!!!', ID), 'post-12345678');
  assert.equal(normalizedContentSlug('page', '', '!!!', ID), 'page-12345678');
  const long = normalizedContentSlug('post', `${'a'.repeat(SLUG_LENGTH)}-b`, 'x', ID);
  assert.ok(long.length <= SLUG_LENGTH, 'one past the cap is cut as before');
});
