import assert from 'node:assert/strict';
import test from 'node:test';

import { insetsWithin, isMoving, placePopover } from '../../src/lib/popover';

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

/** A containing block 1280 x 800 laid out, drawn at `left`, `top` and `scale`: the window when it is not moved. */
const block = (left = 0, top = 0, scale = 1) => ({ left, top, bottom: top + 800 * scale, width: 1280 * scale, height: 800 * scale, laidOutWidth: 1280, laidOutHeight: 800 });
const below = { left: 100, top: 144, bottom: null, viewportHeight: 800 };
const above = { left: 100, top: null, bottom: 400, viewportHeight: 800 };

test('in the window, a panel keeps the offsets it was placed at', () => {
  assert.deepEqual(insetsWithin(block(), below), { left: 100, top: 144, bottom: null });
  assert.deepEqual(insetsWithin(block(), above), { left: 100, top: null, bottom: 400 });
});

test('inside a box that has moved, the offsets are taken back by as much', () => {
  // A dialog 300px down and 40px across is the containing block: measured from it, not the window.
  assert.deepEqual(insetsWithin(block(40, 300), below), { left: 60, top: -156, bottom: null });
  // Placed by its bottom, it is measured up from the box's bottom edge, here 300px below the window's.
  assert.deepEqual(insetsWithin(block(40, 300), above), { left: 60, top: null, bottom: 700 });
  // A drawer still 900px off to the right.
  assert.deepEqual(insetsWithin(block(900, 0), below), { left: -800, top: 144, bottom: null });
});

test('inside a box that is also scaled, the offsets are scaled with it', () => {
  // At 0.98 a pixel of style is 0.98 of a pixel on screen.
  const { left, top } = insetsWithin(block(10, 20, 0.98), below);
  assert.ok(Math.abs(10 + left * 0.98 - 100) < 1e-9 && Math.abs(20 + top! * 0.98 - 144) < 1e-9, JSON.stringify({ left, top }));
  const { bottom } = insetsWithin(block(10, 20, 0.98), above);
  assert.ok(Math.abs(20 + 800 * 0.98 - bottom! * 0.98 - (800 - 400)) < 1e-9, String(bottom));
});

test('a box with no size is taken at its own scale', () => {
  assert.deepEqual(insetsWithin({ ...block(10, 20), width: 0, height: 0, laidOutWidth: 0, laidOutHeight: 0, bottom: 20 }, below), { left: 90, top: 124, bottom: null });
});

test('a box is still moving while it is drawn anywhere but where it is laid out', () => {
  assert.equal(isMoving(block()), false, 'the window');
  // A classic scrollbar takes width from the box as laid out and as drawn alike: still the window.
  assert.equal(isMoving({ ...block(), width: 1263, laidOutWidth: 1263 }), false, 'the window beside a scrollbar');
  assert.equal(isMoving(block(900, 0)), true, 'a drawer still off to the side');
  assert.equal(isMoving(block(0, 0, 0.98)), true, 'a dialog still growing into place');
  // At 110% a 1280px window is 1163.64 CSS pixels, laid out rounded to 1164: still the window.
  assert.equal(isMoving({ left: 0.3, top: 0, bottom: 800, width: 1163.64, height: 800, laidOutWidth: 1164, laidOutHeight: 800 }), false, 'a zoomed window');
  assert.equal(isMoving({ ...block(), height: 727.27, laidOutHeight: 727 }), false, 'a zoomed window, down');
});

test('a drawer with a classic scrollbar is measured from its start, which the bar does not move', () => {
  // 448px wide, its border at 1263 and a 17px bar inside it: the box a panel is placed in is 430 wide.
  const drawer = { left: 1264, top: 0, bottom: 800, width: 430, height: 800, laidOutWidth: 430, laidOutHeight: 800 };
  assert.deepEqual(insetsWithin(drawer, { ...below, left: 984 }), { left: -280, top: 144, bottom: null });
});
