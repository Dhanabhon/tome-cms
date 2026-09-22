import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { ADMIN_NAV_IDS } from '../../src/lib/admin';
import { ICONS } from '../../src/lib/icons';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('every sidebar link has an icon', () => {
  for (const id of ADMIN_NAV_IDS) assert.ok(ICONS[id], `no icon for ${id}`);
});

test('an icon is nothing but stroked shapes', () => {
  // The markup is set as HTML, so the map holds only the elements a line icon is made of.
  for (const [name, markup] of Object.entries(ICONS)) {
    const elements = [...markup.matchAll(/<([a-z]+)\b/g)].map(([, element]) => element);
    assert.ok(elements.length > 0, `${name} is empty`);
    for (const element of elements) assert.match(element, /^(path|rect|circle)$/, `${name} uses <${element}>`);
  }
});

test('the list screens have the icons they draw', () => {
  // A date and a row menu were a "⋯" and a "✎" typed into the markup: two glyphs whose
  // weight and size come from whatever font renders them, beside thirteen drawn icons.
  for (const name of ['clock', 'more'] as const) assert.ok(ICONS[name], `no icon for ${name}`);
});

test('both icon components draw the same svg', () => {
  // One icon set, two renderers: a page uses the Astro component, an island the React one.
  // If their attributes drift, the same icon looks different depending on who drew it.
  const astro = read('src/components/Icon.astro');
  const react = read('src/components/Icon.tsx');
  for (const attribute of ['aria-hidden', 'fill="none"', 'stroke="currentColor"', 'viewBox="0 0 24 24"']) {
    const pattern = new RegExp(attribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    assert.match(astro, pattern, `astro: ${attribute}`);
    assert.match(react, pattern, `react: ${attribute}`);
  }
  assert.match(react, /strokeWidth=\{1\.5\}/, 'react: stroke width');
  assert.match(react, /strokeLinecap="round"/, 'react: line cap');
});

test('the menu editor has the icons it draws', () => {
  for (const name of ['grip', 'up', 'down', 'trash'] as const) assert.ok(ICONS[name], `no icon for ${name}`);
});

test('the category rows have the icon they draw', () => {
  assert.ok(ICONS.pencil, 'no icon for pencil');
});

test('the formatting bar draws a link as a link', () => {
  // It was an arrow, '↗', which reads as "open" or "go" and never as "link".
  assert.ok(ICONS.link, 'no icon for link');
  for (const name of ['alignLeft', 'alignCenter', 'alignRight'] as const) assert.ok(ICONS[name], `no icon for ${name}`);
  assert.doesNotMatch(read('src/components/admin/DocumentCanvas.tsx'), /'↗'/, 'the formatting bar still types an arrow');
});

test('the block menus have the icons they draw', () => {
  // Both of them drew letters and punctuation before this -- "H2", a bullet, a curly quote
  // -- whose weight and size came from whatever font rendered them, in a screen of drawn
  // icons. The + menu drew nothing at all.
  const names = ['text', 'heading1', 'heading2', 'heading3', 'list', 'quote', 'code', 'media', 'table', 'plus', 'minus', 'trash'] as const;
  for (const name of names) assert.ok(ICONS[name], `no icon for ${name}`);

  for (const path of ['src/components/admin/BlockInsertMenu.tsx', 'src/components/admin/editor/slash-items.tsx']) {
    const source = read(path);
    assert.doesNotMatch(source, /aria-hidden="true">(H[123]|•|“|\{'<\/>'\})/, `${path} still types a glyph`);
  }
});
