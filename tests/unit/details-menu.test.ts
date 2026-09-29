import assert from 'node:assert/strict';
import test from 'node:test';

import { menusToClose } from '../../src/lib/details-menu';

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
