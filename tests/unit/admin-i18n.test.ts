import assert from 'node:assert/strict';
import { test } from 'node:test';

import { adminCopy, adminDateFormat, statusLabel } from '../../src/lib/admin-i18n';

type Leaf = [path: string, value: string];

function leaves(value: unknown, path: string[] = []): Leaf[] {
  if (typeof value === 'string') return [[path.join('.'), value]];
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) => leaves(child, [...path, key]));
}

const en = leaves(adminCopy('en'));
const th = leaves(adminCopy('th'));

test('both locales expose exactly the same keys', () => {
  assert.deepEqual(th.map(([path]) => path), en.map(([path]) => path));
});

test('no entry in either locale is blank', () => {
  for (const [path, value] of [...en, ...th]) {
    assert.ok(value.trim().length > 0, `${path} is empty`);
  }
});

/** What is left of an entry once placeholders, digits and punctuation are removed. */
const translatable = (value: string) =>
  value.replace(/\{\w+\}/g, '').replace(/[\d\s\p{P}\p{S}]/gu, '');

test('every Thai entry that contains words is actually translated', () => {
  // The type system checks that keys exist; it cannot catch an English value
  // pasted into the Thai catalogue, which is how half-translated UIs happen.
  // Entries that are pure interpolation ('{width} x {height}') carry no words
  // to translate and are exempt — but nothing else is.
  for (const [path, value] of th) {
    if (!translatable(value)) continue;
    assert.match(value, /[฀-๿]/, `${path} carries no Thai characters: ${value}`);
  }
});

test('the exemption is narrow enough to still catch untranslated English', () => {
  assert.equal(translatable('{width} × {height}, {format}'), '', 'pure interpolation is exempt');
  assert.notEqual(translatable('Delete {name}?'), '', 'a real word must never be exempt');
  assert.notEqual(translatable('Save'), '', 'a bare English word must never be exempt');
});

test('an unknown or absent locale falls back to English', () => {
  assert.equal(adminCopy(null).nav.posts, 'Posts');
  assert.equal(adminCopy(undefined).nav.posts, 'Posts');
  assert.equal(adminCopy('en').nav.posts, 'Posts');
  assert.equal(adminCopy('th').nav.posts, 'บทความ');
});

test('status labels follow the owner language, not the stored enum', () => {
  assert.equal(statusLabel(adminCopy('th'), 'published'), 'เผยแพร่แล้ว');
  assert.equal(statusLabel(adminCopy('th'), 'draft'), 'ฉบับร่าง');
  assert.equal(statusLabel(adminCopy('en'), 'published'), 'Published');
  assert.equal(statusLabel(adminCopy('en'), 'draft'), 'draft');
});

test('dates are formatted in the owner language and the site timezone', () => {
  const moment = new Date('2026-09-14T03:04:00.000Z');
  const bangkok = adminDateFormat('en', 'Asia/Bangkok').format(moment);
  assert.match(bangkok, /10:04/, 'UTC+7 must shift the clock, not just relabel it');
  assert.notEqual(adminDateFormat('th', 'Asia/Bangkok').format(moment), bangkok);
});
