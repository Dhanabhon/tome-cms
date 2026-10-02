import assert from 'node:assert/strict';
import test from 'node:test';

import { isCurrentSection } from '../../src/lib/navigation-current';
import type { PublicNavigationItem } from '../../src/types/cms';

const leaf = (href: string): PublicNavigationItem => ({ href, kind: 'page', label: href, newTab: false, children: [] });
const parent = (href: string | null, ...children: PublicNavigationItem[]): PublicNavigationItem => (
  { href, kind: href === null ? 'group' : 'page', label: 'Parent', newTab: false, children }
);

test('a parent is the current section when one of its sub-items is the page being viewed', () => {
  assert.equal(isCurrentSection(parent('/en/company', leaf('/en/about'), leaf('/en/team')), '/en/team'), true);
  assert.equal(isCurrentSection(parent(null, leaf('/en/about')), '/en/about'), true);
});

test('it is not the current section for another page, the parent own page, or an item with no sub-items', () => {
  assert.equal(isCurrentSection(parent('/en/company', leaf('/en/about')), '/en/contact'), false);
  assert.equal(isCurrentSection(parent('/en/company', leaf('/en/about')), '/en/company'), false);
  assert.equal(isCurrentSection(leaf('/en/about'), '/en/about'), false);
});
