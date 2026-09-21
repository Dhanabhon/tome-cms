import assert from 'node:assert/strict';
import test from 'node:test';

import { iconLinks, NO_BRAND, siteBrand, storedBrandKeys, type StoredBrand } from '../../src/lib/site-brand';

const logo = { height: 80, key: 'owners/o/2026/09/a.svg', mime: 'image/svg+xml' as const, width: 240 };
const dark = { ...logo, key: 'owners/o/2026/09/b.svg' };
const icon = { png180Key: 'owners/o/2026/09/c.png', png32Key: 'owners/o/2026/09/d.png', svgKey: 'owners/o/2026/09/e.svg' };
const resolve = (key: string) => `https://media.test/${key}`;
const stored = (overrides: Partial<StoredBrand>): StoredBrand => ({
  brand_icon: null, brand_logo: null, brand_logo_dark: null, hide_site_name: false, ...overrides,
});

test('the name leaves the header only while a logo stands in for it', () => {
  assert.equal(siteBrand(stored({ brand_logo: logo, hide_site_name: true }), resolve).showSiteName, false);
  assert.equal(siteBrand(stored({ brand_logo: logo }), resolve).showSiteName, true);
  // The switch still says hide; with no logo the header needs the name, so it stays.
  assert.equal(siteBrand(stored({ hide_site_name: true }), resolve).showSiteName, true);
});

test('a dark logo is drawn only beside a logo', () => {
  const both = siteBrand(stored({ brand_logo: logo, brand_logo_dark: dark }), resolve);
  assert.equal(both.logoDark?.url, `https://media.test/${dark.key}`);
  assert.equal(siteBrand(stored({ brand_logo_dark: dark }), resolve).logoDark, null);
});

test('keys become addresses, and nothing else of the key leaks', () => {
  const brand = siteBrand(stored({ brand_icon: icon, brand_logo: logo }), resolve);
  assert.deepEqual(brand.logo, { height: 80, mimeType: 'image/svg+xml', url: `https://media.test/${logo.key}`, width: 240 });
  assert.deepEqual(brand.icon, {
    png180: `https://media.test/${icon.png180Key}`, png32: `https://media.test/${icon.png32Key}`, svg: `https://media.test/${icon.svgKey}`,
  });
  assert.deepEqual(siteBrand(stored({}), resolve), NO_BRAND);
});

test('every object a stored value names is found, and garbage names none', () => {
  assert.deepEqual(storedBrandKeys(logo), [logo.key]);
  assert.deepEqual(storedBrandKeys(icon), [icon.svgKey, icon.png32Key, icon.png180Key]);
  assert.deepEqual(storedBrandKeys({ ...icon, svgKey: null }), [icon.png32Key, icon.png180Key]);
  for (const nothing of [null, undefined, {}, 'owners/x.png', { key: 42 }]) assert.deepEqual(storedBrandKeys(nothing), []);
});

test('the icon links a public page carries, in the order browsers read them', () => {
  assert.deepEqual(iconLinks(null), [{ href: '/favicon.svg', rel: 'icon', type: 'image/svg+xml' }]);
  const links = iconLinks(siteBrand(stored({ brand_icon: icon }), resolve).icon);
  assert.deepEqual(links.map(({ rel, sizes, type }) => [rel, sizes ?? null, type ?? null]), [
    ['icon', '32x32', 'image/png'],
    ['icon', null, 'image/svg+xml'],
    ['apple-touch-icon', null, null],
  ]);
  assert.equal(iconLinks(siteBrand(stored({ brand_icon: { ...icon, svgKey: null } }), resolve).icon).length, 2);
});
