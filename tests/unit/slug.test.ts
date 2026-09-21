import assert from 'node:assert/strict';
import test from 'node:test';

import { contentSlug, SLUG, SLUG_LENGTH } from '../../src/lib/slug';

test('a Thai title has a Thai address, a word between each pair of hyphens', () => {
  const slug = contentSlug('เขียนไว้อย่างตั้งใจ เผยแพร่อย่างพิถีพิถัน');
  assert.notEqual(slug, '', 'it was empty, and then post-a1b2c3d4');
  assert.match(slug, SLUG);
  // Split where ICU says the words are, not only where the one space was.
  assert.ok(slug.split('-').length > 2, `${slug} is one run of letters`);
  assert.equal(slug.replaceAll('-', ''), 'เขียนไว้อย่างตั้งใจเผยแพร่อย่างพิถีพิถัน', 'every letter kept, none invented');
});

test('a mixed title keeps both languages', () => {
  const slug = contentSlug('รวมทุกความคิดไว้ใน TomeCMS');
  assert.ok(slug.includes('tomecms'), slug);
  assert.ok(/\p{Script=Thai}/u.test(slug), `${slug} lost its Thai again`);
  assert.match(slug, SLUG);
});

test('an English title is what it was', () => {
  assert.equal(contentSlug('How to run Claude like a tech lead'), 'how-to-run-claude-like-a-tech-lead');
  assert.equal(contentSlug('Café au lait'), 'cafe-au-lait', 'accents still transliterate');
});

test('an address that already is one stays exactly where it is', () => {
  // Every save normalises the slug it is given. If that moved an existing address, every
  // article saved after this change would quietly break every link to it.
  for (const existing of [
    'claude-code-intentmd-anthropic',
    'the-4-lines-every-claudemd-needs',
    'post-a1b2c3d4',
    'page-9f3c2e11',
    '2026-09-20-release',
    'เขียน-ไว้-อย่าง-ตั้งใจ',
  ]) {
    assert.equal(contentSlug(existing), existing, `${existing} moved`);
  }
});

test('nothing sayable is an empty answer, and a long title stops at a word', () => {
  assert.equal(contentSlug('!!! ... ???'), '');
  const long = contentSlug('การจัดการ '.repeat(40));
  assert.ok(long.length <= SLUG_LENGTH, `${long.length}`);
  assert.equal(contentSlug(long), long, 'and what it stopped at is itself a whole address');
});

test('the rule an address is checked against takes Thai, and still refuses the rest', () => {
  for (const good of ['hello-world', 'เขียน-ไว้', 'post-123', 'รวม-tomecms']) assert.match(good, SLUG, good);
  for (const bad of ['Hello', 'hello--world', '-hello', 'hello-', 'hello world', 'привет', '../etc', 'a/b']) {
    assert.doesNotMatch(bad, SLUG, bad);
  }
});
