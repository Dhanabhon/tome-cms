import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ADMIN_ICONS, ADMIN_NAV_IDS } from '../../src/lib/admin-icons';

test('every sidebar link has an icon', () => {
  for (const id of ADMIN_NAV_IDS) assert.ok(ADMIN_ICONS[id], `no icon for ${id}`);
});

test('an icon is nothing but stroked shapes', () => {
  // The markup is set as HTML, so the map holds only the elements a line icon is made of.
  for (const [name, markup] of Object.entries(ADMIN_ICONS)) {
    const elements = [...markup.matchAll(/<([a-z]+)\b/g)].map(([, element]) => element);
    assert.ok(elements.length > 0, `${name} is empty`);
    for (const element of elements) assert.match(element, /^(path|rect|circle)$/, `${name} uses <${element}>`);
  }
});

test('the list screens have the icons they draw', () => {
  // A date and a row menu were a "⋯" and a "✎" typed into the markup: two glyphs whose
  // weight and size come from whatever font renders them, beside thirteen drawn icons.
  for (const name of ['clock', 'more'] as const) assert.ok(ADMIN_ICONS[name], `no icon for ${name}`);
});
