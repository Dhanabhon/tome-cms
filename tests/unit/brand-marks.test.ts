import assert from 'node:assert/strict';
import test from 'node:test';

import { BRAND_MARKS } from '../../src/lib/brand-marks';

test('every id in the marks is unique, since a mark is drawn inline and its ids are the whole page\'s', () => {
  const ids = Object.values(BRAND_MARKS).flatMap((mark) => [...mark.paths.matchAll(/\bid="([^"]*)"/g)].map((match) => match[1]));
  assert.ok(ids.length > 0, 'the Gemini mark has ids, so this is not vacuous');
  assert.deepEqual(ids, [...new Set(ids)]);
});
