import assert from 'node:assert/strict';
import test from 'node:test';

import { migrations } from '../../src/server/db/migrator';

test('ships ordered, uniquely named forward migrations', () => {
  const names = Object.keys(migrations);
  assert.deepEqual(names, [...names].sort());
  assert.equal(new Set(names).size, names.length);
  assert.match(names[0] ?? '', /^001_/);
  assert.equal(names.at(-1), '020_site_brand');
});
