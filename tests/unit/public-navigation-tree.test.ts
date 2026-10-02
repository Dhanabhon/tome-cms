import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPublicNavigation } from '../../src/server/content/public-navigation';

type Row = Parameters<typeof buildPublicNavigation>[0][number];

let sequence = 0;
const row = (over: Partial<Row> & Pick<Row, 'kind' | 'label'>): Row => ({
  id: `row-${++sequence}`, location: 'header', page_id: null, parent_id: null, url: null, new_tab: false, ...over,
});
const pages = new Map([['live', '/en/about'], ['live-too', '/en/team']]);
const build = (rows: Row[], urls = pages) => buildPublicNavigation(rows, urls, 'en');

test('a flat menu keeps its items, each with an empty children list', () => {
  const navigation = build([
    row({ kind: 'home', label: 'Home' }),
    row({ kind: 'page', label: 'About', page_id: 'live' }),
    row({ kind: 'custom', label: 'Elsewhere', url: 'https://example.com', new_tab: true }),
  ]);
  assert.deepEqual(navigation, {
    footer: [],
    header: [
      { href: '/en', kind: 'home', label: 'Home', newTab: false, children: [] },
      { href: '/en/about', kind: 'page', label: 'About', newTab: false, children: [] },
      { href: 'https://example.com/', kind: 'custom', label: 'Elsewhere', newTab: true, children: [] },
    ],
  });
});

test('sub-items nest under their parent in the order given, and a sub-item whose page is not live is dropped', () => {
  const parent = row({ kind: 'home', label: 'Home' });
  const navigation = build([
    parent,
    row({ kind: 'page', label: 'About', page_id: 'live', parent_id: parent.id }),
    row({ kind: 'page', label: 'Draft', page_id: 'missing', parent_id: parent.id }),
    row({ kind: 'page', label: 'Team', page_id: 'live-too', parent_id: parent.id }),
  ]);
  assert.deepEqual(navigation.header.map(({ label, children }) => [label, children.map((child) => child.label)]), [['Home', ['About', 'Team']]]);
  assert.equal(navigation.header[0]?.children[0]?.href, '/en/about');
});

test('a page parent that is gone but has live sub-items becomes a group with no link', () => {
  const parent = row({ kind: 'page', label: 'Company', page_id: 'missing' });
  const [item] = build([parent, row({ kind: 'page', label: 'About', page_id: 'live', parent_id: parent.id })]).header;
  assert.equal(item?.kind, 'group');
  assert.equal(item?.href, null);
  assert.equal(item?.newTab, false);
  assert.deepEqual(item?.children.map(({ label }) => label), ['About']);
});

test('a group is kept while a sub-item is live and dropped once none is', () => {
  const group = row({ kind: 'group', label: 'More' });
  const gone = row({ kind: 'page', label: 'Draft', page_id: 'missing', parent_id: group.id });
  assert.deepEqual(build([group, gone]).header, [], 'a group with no live sub-items is dropped');
  assert.equal(build([group, row({ kind: 'page', label: 'About', page_id: 'live', parent_id: group.id })]).header[0]?.kind, 'group');
});

test('a page parent that is gone with no live sub-items is dropped', () => {
  const parent = row({ kind: 'page', label: 'Company', page_id: 'missing' });
  assert.deepEqual(build([parent, row({ kind: 'page', label: 'Draft', page_id: 'missing', parent_id: parent.id })]).header, []);
  assert.deepEqual(build([parent]).header, []);
});

test('the footer stays flat: no sub-items, and a group is never shown', () => {
  const parent = row({ kind: 'home', label: 'Home', location: 'footer' });
  const group = row({ kind: 'group', label: 'More', location: 'footer' });
  const navigation = build([
    parent,
    row({ kind: 'page', label: 'About', page_id: 'live', location: 'footer', parent_id: parent.id }),
    group,
    row({ kind: 'page', label: 'Team', page_id: 'live-too', location: 'footer', parent_id: group.id }),
  ]);
  assert.deepEqual(navigation.footer, [{ href: '/en', kind: 'home', label: 'Home', newTab: false, children: [] }]);
});

test('a menu is cut at 50 items', () => {
  const rows = Array.from({ length: 60 }, (_, index) => row({ kind: 'custom', label: `Link ${index}`, url: `https://example.com/${index}` }));
  assert.equal(build(rows).header.length, 50);
});
