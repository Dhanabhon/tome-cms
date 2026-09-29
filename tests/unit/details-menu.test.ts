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
