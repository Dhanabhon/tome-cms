import assert from 'node:assert/strict';
import test from 'node:test';

import { isOrphan, ORPHAN_MIN_AGE_MS } from '../../src/server/media/orphans';

const key = 'owners/123e4567-e89b-42d3-a456-426614174000/2026/09/123e4567-e89b-42d3-a456-426614174001.webp';
const now = new Date('2026-10-07T12:00:00.000Z');
const at = (age: number) => new Date(now.getTime() - age);

test('the sweep takes only an untracked TomeCMS key a full day old', () => {
  assert.equal(isOrphan({ Key: key, LastModified: at(ORPHAN_MIN_AGE_MS) }, new Set(), now), true, 'exactly a day old is swept');
  assert.equal(isOrphan({ Key: key, LastModified: at(ORPHAN_MIN_AGE_MS - 1) }, new Set(), now), false, 'a millisecond younger is kept');
  assert.equal(isOrphan({ Key: key }, new Set(), now), false, 'no LastModified is kept');
  assert.equal(isOrphan({ Key: key, LastModified: at(ORPHAN_MIN_AGE_MS) }, new Set([key]), now), false, 'a tracked key is kept');
  assert.equal(isOrphan({ Key: 'another-app/notes.txt', LastModified: at(10 * ORPHAN_MIN_AGE_MS) }, new Set(), now), false, 'a foreign key is kept');
  assert.equal(isOrphan({ LastModified: at(ORPHAN_MIN_AGE_MS) }, new Set(), now), false, 'no key is kept');
});
