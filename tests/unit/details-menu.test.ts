import assert from 'node:assert/strict';
import test from 'node:test';

import { menuToEscape, menusToClose } from '../../src/lib/details-menu';

const menu = (open: boolean, inside: unknown[] = []) => ({ open, contains: (node: unknown) => inside.includes(node) });

test('a press outside closes every open menu, and none that is closed', () => {
  const a = menu(true); const b = menu(false); const c = menu(true);
  assert.deepEqual(menusToClose([a, b, c], {}), [a, c]);
});

test('a press inside an open menu leaves that menu open', () => {
  const target = {};
  const a = menu(true, [target]); const b = menu(true);
  assert.deepEqual(menusToClose([a, b], target), [b]);
});

test('Escape takes the menu that holds focus, else the open one, else none', () => {
  const focus = {};
  const a = menu(true); const b = menu(true, [focus]);
  assert.equal(menuToEscape([a, b], focus), b);
  assert.equal(menuToEscape([menu(false), a], null), a);
  assert.equal(menuToEscape([menu(false)], null), undefined);
});

test('Escape falls back to the open menu only when focus is on nothing, so a dialog keeps its own Escape', () => {
  const body = {}; const inDialog = {};
  const open = menu(true);
  // Safari does not focus a summary on click: focus stays on the body, and Escape still closes the menu.
  assert.equal(menuToEscape([open], body, body), open);
  assert.equal(menuToEscape([open], null, body), open);
  // Focus in a confirm dialog (or an open language list) is not the menu's to take.
  assert.equal(menuToEscape([open], inDialog, body), undefined);
});
