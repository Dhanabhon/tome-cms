import assert from 'node:assert/strict';
import test from 'node:test';

import { placePopover } from '../../src/lib/popover';

const rect = (top: number, bottom: number, left = 100, width = 200) => ({ top, bottom, left, width }) as DOMRect;

test('a panel opens below when it fits', () => {
  const place = placePopover(rect(100, 140), 200, 800, 16);
  assert.equal(place.top, 144);
  assert.equal(place.bottom, null);
  assert.equal(place.minWidth, 200, 'never narrower than its trigger');
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
  assert.equal(placePopover(rect(100, 140), 200, 800, 16, { matchWidth: false }).minWidth, null);
});

/** A 1440-wide window, and a panel as wide as `panelWidth`. */
const wide = (trigger: DOMRect, panelWidth: number) => placePopover(trigger, 200, 800, 16, { panelWidth, viewportWidth: 1440 });

test('a list opens at its trigger\'s start when it fits there, and grows to fit its options', () => {
  const place = wide(rect(100, 140, 100, 100), 240);
  assert.equal(place.left, 100);
  assert.equal(place.minWidth, 100, 'the trigger\'s width is the least it takes');
  assert.equal(place.maxWidth, 1440 - 2 * 8, 'and the window less its gutters the most');
});

test('a list wider than the room from its trigger\'s start to the edge lines up with the trigger\'s end', () => {
  // The trigger ends at 1300; 232px are left from its start, and the list wants 300.
  assert.equal(wide(rect(100, 140, 1200, 100), 300).left, 1300 - 300);
});

test('a trigger in the end half of the window takes its list to the end, even when the list is narrow', () => {
  assert.equal(wide(rect(100, 140, 1000, 100), 120).left, 1100 - 120);
  assert.equal(wide(rect(100, 140, 500, 100), 120).left, 500, 'and one in the start half does not');
});

test('a list lined up with its end stays in the window at its start', () => {
  const small = placePopover(rect(100, 140, 100, 100), 200, 800, 16, { panelWidth: 500, viewportWidth: 300 });
  assert.equal(small.left, 8);
  assert.equal(small.maxWidth, 300 - 16);
});

test('a panel with no width to measure keeps the start of its trigger, as a date panel does', () => {
  assert.equal(placePopover(rect(100, 140, 1200, 100), 200, 800, 16, { matchWidth: false }).left, 1200);
});
