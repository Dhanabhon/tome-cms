import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { ADMIN_ICONS, ADMIN_NAV_IDS } from '../../src/lib/admin-icons';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

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

test('both icon components draw the same svg', () => {
  // One icon set, two renderers: a page uses the Astro component, an island the React one.
  // If their attributes drift, the same icon looks different depending on who drew it.
  const astro = read('src/components/admin/AdminIcon.astro');
  const react = read('src/components/admin/AdminIcon.tsx');
  for (const attribute of ['aria-hidden', 'fill="none"', 'stroke="currentColor"', 'viewBox="0 0 24 24"']) {
    const pattern = new RegExp(attribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    assert.match(astro, pattern, `astro: ${attribute}`);
    assert.match(react, pattern, `react: ${attribute}`);
  }
  assert.match(react, /strokeWidth=\{1\.5\}/, 'react: stroke width');
  assert.match(react, /strokeLinecap="round"/, 'react: line cap');
});
