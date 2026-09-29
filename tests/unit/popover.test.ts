import assert from 'node:assert/strict';
import test from 'node:test';

import { placePopover } from '../../src/lib/popover';

const rect = (top: number, bottom: number, left = 100, width = 200) => ({ top, bottom, left, width }) as DOMRect;

test('a panel opens below when it fits', () => {
  const place = placePopover(rect(100, 140), 200, 800, 16);
  assert.equal(place.top, 144);
  assert.equal(place.bottom, null);
  assert.equal(place.width, 200);
});

test('a panel flips above when more of it fits there', () => {
  const place = placePopover(rect(600, 640), 300, 800, 16);
  assert.equal(place.top, null);
  assert.equal(place.bottom, 800 - 600 + 4);
});

test('a panel is capped by the room it took, never cut by what it is inside', () => {
  const place = placePopover(rect(100, 140), 2000, 800, 16);
  assert.equal(place.maxHeight, Math.min(800 - 140 - 4, 20 * 16));
});

test('a panel that does not match its trigger leaves width to its own content', () => {
  assert.equal(placePopover(rect(100, 140), 200, 800, 16, { matchWidth: false }).width, null);
});
