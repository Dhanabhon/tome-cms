import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { TONE_COUNT, tone } from '../../src/themes/almanac/tone';

test('a category keeps its tone from one page to the next', () => {
  const id = '6f1c2a90-3d4b-4e5f-8a7b-1c2d3e4f5a6b';
  assert.equal(tone(id), tone(id));
  assert.equal(tone(id), tone(String(id)), 'a copy of the id, not the same string object');
});

test('a tone is one of the six, and different ids reach all six', () => {
  assert.equal(TONE_COUNT, 6);
  const seen = new Set<number>();
  for (let index = 0; index < 200; index += 1) {
    const value = tone(`category-${index}`);
    assert.ok(Number.isInteger(value) && value >= 0 && value < TONE_COUNT, `${value} is a tone`);
    seen.add(value);
  }
  assert.equal(seen.size, TONE_COUNT, 'every tone is used');
});

test('the tone does not depend on the runtime: pinned values', () => {
  // A hash that changed between releases would repaint every card on the site at once.
  assert.deepEqual(['', 'a', 'news', 'ข่าว'].map(tone), [1, 4, 4, 0]);
});

test('every tone the helper can return has a surface and a text colour in the stylesheet', () => {
  const css = readFileSync(new URL('../../src/themes/almanac/theme.css', import.meta.url), 'utf8');
  for (let index = 0; index < TONE_COUNT; index += 1) {
    assert.match(css, new RegExp(`--almanac-tone-${index}:`), `tone ${index} has a surface`);
    assert.match(css, new RegExp(`--almanac-tone-${index}-ink:`), `tone ${index} has a text colour`);
  }
});
