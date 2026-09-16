import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { cardsToRowEnd, categoryOf } from '../../src/lib/post-feed';

const CSS = readFileSync(new URL('../../src/styles/global.css', import.meta.url), 'utf8');

test('a card held back by the feed stays out of sight', () => {
  // .post-card and the retry button set their own display, and an author display outranks the
  // hidden attribute's: a held page showed all at once instead of a row at a time.
  const rule = /(?:^|\n)\.post-card\[hidden\],\s*\.post-more \[hidden\]\s*\{([^}]*)\}/.exec(CSS);
  assert.ok(rule, 'no rule hides a held card and a hidden retry button');
  assert.match(rule[1], /display\s*:\s*none/);
});

test('a level grid gets one whole row at the width it is shown at', () => {
  assert.equal(cardsToRowEnd(6, 3), 3);
  assert.equal(cardsToRowEnd(6, 2), 2);
  assert.equal(cardsToRowEnd(6, 1), 1);
});

test('a row left short by a resize is topped up to its end, not added to', () => {
  // Seven cards shown one across, then the window widens to three: the third row has one card.
  assert.equal(cardsToRowEnd(7, 3), 2);
  assert.equal(cardsToRowEnd(5, 2), 1);
});

test('a grid that reports no columns still moves forward one card', () => {
  assert.equal(cardsToRowEnd(4, 0), 1);
});

test('a pill and an address name the same filter the way the server matches it', () => {
  // The server trims the category and compares it case-blind, so the pill marked current
  // after a swap or a Back must be the one whose list is on screen.
  assert.equal(categoryOf(new URL('https://blog.test/th')), '');
  assert.equal(categoryOf(new URL('https://blog.test/th?category=')), '');
  assert.equal(categoryOf(new URL('https://blog.test/th?category=Design')), 'design');
  assert.equal(categoryOf(new URL('https://blog.test/th?category=+DESIGN+&cursor=abc')), 'design');
  assert.equal(categoryOf(new URL('https://blog.test/th?category=%E0%B8%97%E0%B8%B1%E0%B9%88%E0%B8%A7%E0%B9%84%E0%B8%9B')), 'ทั่วไป');
});
