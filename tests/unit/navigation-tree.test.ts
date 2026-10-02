import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyDrop, canIndent, canOutdent, dropAction, emptyGroups, fromRows, indent, moveBlock, outdent, removeItem, sibling, toMutation,
  type NavigationDraftItem,
} from '../../src/lib/navigation-tree';

// Each item's id is its label, so a menu reads as its labels with their parents: "B<A" is B under A.
const item = (id: string, parentId: string | null = null, over: Partial<NavigationDraftItem> = {}): NavigationDraftItem => ({
  id, kind: 'custom', label: id, pageId: null, url: `/${id.toLowerCase()}`, newTab: false, parentId, ...over,
});
const shape = (items: NavigationDraftItem[]) => items.map((entry) => entry.parentId ? `${entry.id}<${entry.parentId}` : entry.id);
// A, with B and C under it, then D, with E under it, then F.
const menu = () => [item('A'), item('B', 'A'), item('C', 'A'), item('D'), item('E', 'D'), item('F')];

test('the first item cannot be indented: there is nothing above it to go under', () => {
  assert.equal(canIndent(menu(), 0, 'header'), false);
});

test('an item cannot be indented on the footer, which has no sub-items', () => {
  const flat = [item('A'), item('B')];
  assert.equal(canIndent(flat, 1, 'header'), true);
  assert.equal(canIndent(flat, 1, 'footer'), false);
});

test('an item that has sub-items, a group and a sub-item cannot be indented: there is only one level', () => {
  assert.equal(canIndent(menu(), 3, 'header'), false, 'D holds E');
  assert.equal(canIndent([item('A'), item('G', null, { kind: 'group', url: null })], 1, 'header'), false, 'a group');
  assert.equal(canIndent(menu(), 2, 'header'), false, 'C is already under A');
  assert.equal(canIndent(menu(), 5, 'header'), true, 'F is a plain item');
});

test('indenting makes the item the last sub-item of the top-level item above it, even under a sub-item', () => {
  assert.deepEqual(shape(indent(menu(), 5)), ['A', 'B<A', 'C<A', 'D', 'E<D', 'F<D'], 'F was below E, a sub-item of D');
  assert.deepEqual(shape(indent([item('A'), item('B')], 1)), ['A', 'B<A']);
});

test('indenting what cannot be indented leaves the menu as it was', () => {
  const before = menu();
  assert.equal(indent(before, 3), before);
  assert.equal(indent(before, 0), before);
});

test('only a sub-item can be moved out', () => {
  assert.deepEqual(menu().map((_, index) => canOutdent(menu(), index)), [false, true, true, false, true, false]);
});

test('moving a sub-item out puts it right after its parent’s last sub-item, and its later siblings stay with the parent', () => {
  assert.deepEqual(shape(outdent(menu(), 1)), ['A', 'C<A', 'B', 'D', 'E<D', 'F']);
  assert.deepEqual(shape(outdent(menu(), 2)), ['A', 'B<A', 'C', 'D', 'E<D', 'F']);
  const before = menu();
  assert.equal(outdent(before, 0), before, 'a top-level item has nowhere to go out to');
});

test('moving a parent carries its sub-items, landing before or after another top-level block', () => {
  assert.deepEqual(shape(moveBlock(menu(), 3, 0)), ['D', 'E<D', 'A', 'B<A', 'C<A', 'F'], 'D up, onto A');
  assert.deepEqual(shape(moveBlock(menu(), 0, 3)), ['D', 'E<D', 'A', 'B<A', 'C<A', 'F'], 'A down, onto D');
  assert.deepEqual(shape(moveBlock(menu(), 0, 4)), ['D', 'E<D', 'A', 'B<A', 'C<A', 'F'], 'A dropped on E lands after D’s block');
  assert.deepEqual(shape(moveBlock(menu(), 5, 1)), ['F', 'A', 'B<A', 'C<A', 'D', 'E<D'], 'F dropped on B lands before A’s block');
  assert.deepEqual(shape(moveBlock(menu(), 0, 5)), ['D', 'E<D', 'F', 'A', 'B<A', 'C<A']);
});

test('a sub-item moves among its siblings only', () => {
  assert.deepEqual(shape(moveBlock(menu(), 2, 1)), ['A', 'C<A', 'B<A', 'D', 'E<D', 'F']);
  const before = menu();
  assert.equal(moveBlock(before, 1, 4), before, 'onto a sub-item of another parent');
  assert.equal(moveBlock(before, 1, 0), before, 'onto its own parent');
  assert.equal(moveBlock(before, 4, 5), before, 'onto a top-level item');
  assert.equal(moveBlock(before, 0, 1), before, 'a parent onto its own sub-item');
  assert.equal(moveBlock(before, 2, 2), before);
  assert.equal(moveBlock(before, 2, 9), before);
});

test('up and down step to the sibling before or after, and stop at the ends of the level', () => {
  const items = menu();
  assert.deepEqual(items.map((_, index) => sibling(items, index, -1)), [-1, -1, 1, 0, -1, 3]);
  assert.deepEqual(items.map((_, index) => sibling(items, index, 1)), [3, 2, -1, 5, -1, -1]);
  assert.deepEqual(shape(moveBlock(items, 0, sibling(items, 0, 1))), ['D', 'E<D', 'A', 'B<A', 'C<A', 'F'], 'A down');
});

test('removing a parent keeps its sub-items, at the top level where they were', () => {
  assert.deepEqual(shape(removeItem(menu(), 0)), ['B', 'C', 'D', 'E<D', 'F']);
  assert.deepEqual(shape(removeItem(menu(), 4)), ['A', 'B<A', 'C<A', 'D', 'F']);
});

test('a group with nothing under it is reported, by its index', () => {
  const group = (id: string) => item(id, null, { kind: 'group', url: null });
  assert.deepEqual(emptyGroups([group('G'), item('A'), group('H'), item('B', 'H'), group('I')]), [0, 4]);
  assert.deepEqual(emptyGroups(menu()), []);
});

test('the save body nests sub-items under their parent, and a flat menu is sent exactly as before', () => {
  const items = [item('A'), item('B', 'A', { newTab: true }), item('G', null, { kind: 'group', url: null }), item('C', 'G')];
  assert.deepEqual(toMutation(items), [
    { kind: 'custom', label: 'A', pageId: null, url: '/a', newTab: false, children: [{ kind: 'custom', label: 'B', pageId: null, url: '/b', newTab: true }] },
    { kind: 'group', label: 'G', pageId: null, url: null, newTab: false, children: [{ kind: 'custom', label: 'C', pageId: null, url: '/c', newTab: false }] },
  ]);
  assert.deepEqual(toMutation([item('A')]), [{ kind: 'custom', label: 'A', pageId: null, url: '/a', newTab: false }]);
});

test('listed rows become the draft list, each sub-item after its parent, and round-trip through the save body', () => {
  const row = (id: string, parent_id: string | null = null) => ({
    id, kind: 'custom' as const, label: id, page_id: null, url: `/${id.toLowerCase()}`, new_tab: false, parent_id,
  });
  // Sub-items listed apart from their parents still come back under them, in their own order.
  const drafts = fromRows([row('A'), row('D'), row('B', 'A'), row('E', 'D'), row('C', 'A')]);
  assert.deepEqual(shape(drafts), ['A', 'B<A', 'C<A', 'D', 'E<D']);
  assert.deepEqual(drafts[1], item('B', 'A'));
  assert.deepEqual(toMutation(drafts), toMutation(menu().slice(0, 5)));
});

// Dragging: the pointer's height within the row it is over, from 0 at its top edge to 1 at its bottom.
const drop = (items: NavigationDraftItem[], from: number, onto: number, fraction: number, location: 'header' | 'footer' = 'header') =>
  applyDrop(items, from, dropAction(items, from, onto, fraction, location));

test('a drag onto the middle of a top-level row puts the item under it, as its last sub-item', () => {
  assert.deepEqual(dropAction(menu(), 5, 3, 0.5, 'header'), { kind: 'into', target: 3 });
  assert.deepEqual(shape(drop(menu(), 5, 3, 0.5)), ['A', 'B<A', 'C<A', 'D', 'E<D', 'F<D'], 'F under D, after E');
  assert.deepEqual(shape(drop(menu(), 5, 0, 0.5)), ['A', 'B<A', 'C<A', 'F<A', 'D', 'E<D'], 'F under A, after C');
  assert.deepEqual(shape(drop(menu(), 4, 0, 0.5)), ['A', 'B<A', 'C<A', 'E<A', 'D', 'F'], 'a sub-item can change parent');
});

test('the middle band runs from 28% to 72% of the row; above it is before, below it after', () => {
  assert.deepEqual([0, 0.27, 0.28, 0.72, 0.73, 1].map((fraction) => dropAction(menu(), 5, 3, fraction, 'header')), [
    { kind: 'before', target: 3 }, { kind: 'before', target: 3 }, { kind: 'into', target: 3 },
    { kind: 'into', target: 3 }, { kind: 'after', target: 3 }, { kind: 'after', target: 3 },
  ]);
});

test('the top band of a top-level row puts the item before it, at the top level', () => {
  assert.deepEqual(shape(drop(menu(), 4, 0, 0.1)), ['E', 'A', 'B<A', 'C<A', 'D', 'F'], 'E out of D, above A');
  assert.deepEqual(shape(drop(menu(), 5, 3, 0.1)), ['A', 'B<A', 'C<A', 'F', 'D', 'E<D']);
});

test('the bottom band of a top-level row puts the item after its whole block, at the top level', () => {
  assert.deepEqual(shape(drop(menu(), 5, 0, 0.9)), ['A', 'B<A', 'C<A', 'F', 'D', 'E<D'], 'after A, B and C');
  assert.deepEqual(shape(drop(menu(), 1, 3, 0.9)), ['A', 'C<A', 'D', 'E<D', 'B', 'F'], 'B out of A, after D’s block');
});

test('over a sub-item row the top half is before it and the bottom half after it, under the same parent', () => {
  assert.deepEqual(dropAction(menu(), 5, 1, 0.49, 'header'), { kind: 'before', target: 1 });
  assert.deepEqual(dropAction(menu(), 5, 1, 0.5, 'header'), { kind: 'after', target: 1 });
  assert.deepEqual(shape(drop(menu(), 5, 1, 0.2)), ['A', 'F<A', 'B<A', 'C<A', 'D', 'E<D']);
  assert.deepEqual(shape(drop(menu(), 5, 2, 0.8)), ['A', 'B<A', 'C<A', 'F<A', 'D', 'E<D']);
  assert.deepEqual(shape(drop(menu(), 4, 1, 0.8)), ['A', 'B<A', 'E<A', 'C<A', 'D', 'F'], 'E leaves D for A');
  assert.deepEqual(shape(drop(menu(), 2, 1, 0.2)), ['A', 'C<A', 'B<A', 'D', 'E<D', 'F'], 'among its own siblings');
});

test('a parent dragged by its handle takes its whole block with it', () => {
  assert.deepEqual(shape(drop(menu(), 3, 0, 0.1)), ['D', 'E<D', 'A', 'B<A', 'C<A', 'F'], 'D above A');
  assert.deepEqual(shape(drop(menu(), 0, 5, 0.9)), ['D', 'E<D', 'F', 'A', 'B<A', 'C<A'], 'A below F');
  assert.deepEqual(shape(drop(menu(), 0, 3, 0.9)), ['D', 'E<D', 'A', 'B<A', 'C<A', 'F'], 'A below D’s block');
});

test('a parent with sub-items cannot go under anything: there is only one level', () => {
  const before = menu();
  assert.deepEqual(dropAction(before, 3, 0, 0.5, 'header'), { refused: 'one-level' }, 'D, holding E, into A');
  assert.deepEqual(dropAction(before, 3, 1, 0.2, 'header'), { refused: 'one-level' }, 'D onto B, a sub-item row');
  assert.deepEqual(dropAction(before, 0, 4, 0.8, 'header'), { refused: 'one-level' }, 'A onto E, a sub-item row');
  assert.equal(applyDrop(before, 3, dropAction(before, 3, 0, 0.5, 'header')), before, 'a refused drop changes nothing');
});

test('over its own row a drag says nothing yet; onto its own sub-items it is refused', () => {
  const before = menu();
  for (const fraction of [0.1, 0.5, 0.9]) {
    assert.equal(dropAction(before, 0, 0, fraction, 'header'), null, 'A over itself, where every drag starts');
    assert.equal(dropAction(before, 5, 5, fraction, 'footer'), null);
    assert.deepEqual(dropAction(before, 0, 2, fraction, 'header'), { refused: 'self' }, 'A onto C, under A');
  }
  assert.equal(applyDrop(before, 0, { refused: 'self' }), before);
});

test('a group stays at the top level: it can be placed but not put under another item', () => {
  const items = [item('A'), item('G', null, { kind: 'group', url: null }), item('H', 'G')];
  const lone = [item('A'), item('G', null, { kind: 'group', url: null })];
  assert.deepEqual(dropAction(lone, 1, 0, 0.5, 'header'), { refused: 'group' });
  assert.deepEqual(shape(drop(lone, 1, 0, 0.1)), ['G', 'A']);
  assert.deepEqual(dropAction(items, 1, 0, 0.5, 'header'), { refused: 'one-level' }, 'a group with an item under it is a parent first');
  const beside = [item('A'), item('B', 'A'), item('G', null, { kind: 'group', url: null })];
  assert.deepEqual(dropAction(beside, 2, 1, 0.2, 'header'), { refused: 'group' }, 'a lone group beside a sub-item');
  assert.deepEqual(dropAction(beside, 2, 1, 0.8, 'header'), { refused: 'group' });
});

test('on the footer there is no "into": the upper half is before and the lower half after', () => {
  const flat = [item('A'), item('B'), item('C')];
  assert.deepEqual([0.1, 0.49, 0.5, 0.9].map((fraction) => dropAction(flat, 2, 0, fraction, 'footer')), [
    { kind: 'before', target: 0 }, { kind: 'before', target: 0 }, { kind: 'after', target: 0 }, { kind: 'after', target: 0 },
  ]);
  assert.deepEqual(shape(drop(flat, 2, 0, 0.5, 'footer')), ['A', 'C', 'B']);
  assert.deepEqual(shape(drop(flat, 0, 2, 0.6, 'footer')), ['B', 'C', 'A']);
});

test('a drop that leaves the menu as it was returns the same list', () => {
  const before = menu();
  assert.equal(drop(before, 5, 3, 0.9), before, 'F after D’s block, where it already is');
  assert.equal(drop(before, 2, 1, 0.8), before, 'C after B, where it already is');
});
