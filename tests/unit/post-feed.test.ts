import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { cardsToRowEnd } from '../../src/lib/post-feed';

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
