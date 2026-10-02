import assert from 'node:assert/strict';
import { test } from 'node:test';

import { manifest } from '../../src/themes/almanac/theme';
import { THEME_MANIFESTS } from '../../src/themes/manifests';
import { isThemeId } from '../../src/themes/registry';

// [key, kind, fallback, max]. A text falls back to '' and the template supplies the default in
// the page's language, which is why no fallback here is a sentence.
const EXPECTED = [
  ['hero', 'switch', 'on', undefined],
  ['heroHeadline', 'text', '', 120],
  ['heroLead', 'text', '', 240],
  ['primaryLabel', 'text', '', 40],
  ['primaryLink', 'text', '', 2048],
  ['secondaryLabel', 'text', '', 40],
  ['secondaryLink', 'text', '', 2048],
  ['readingProgress', 'switch', 'on', undefined],
] as const;

test('Almanac declares exactly its eight settings, with their kinds, fallbacks and lengths', () => {
  assert.deepEqual(
    manifest.settings?.map(({ fallback, key, kind, max }) => [key, kind, fallback, max]),
    EXPECTED.map((row) => [...row]),
  );
});

test('every Almanac setting is named and explained in English and Thai', () => {
  for (const setting of manifest.settings ?? []) {
    for (const locale of ['en', 'th'] as const) {
      assert.ok(setting.label[locale].trim(), `${setting.key} has a ${locale} label`);
      assert.ok(setting.hint?.[locale].trim(), `${setting.key} has a ${locale} hint`);
    }
    // Thai copy that is the English pasted twice is not a translation.
    assert.notEqual(setting.label.th, setting.label.en, `${setting.key} is translated`);
    assert.match(setting.hint?.th ?? '', /[฀-๿]/, `${setting.key}'s Thai hint is Thai`);
  }
});

test('Almanac is offered where the owner chooses a theme, and the registry can draw it', () => {
  assert.equal(manifest.id, 'almanac');
  assert.equal(manifest.name, 'Almanac');
  assert.ok(manifest.description.trim());
  assert.ok(THEME_MANIFESTS.includes(manifest));
  assert.equal(isThemeId('almanac'), true);
});
