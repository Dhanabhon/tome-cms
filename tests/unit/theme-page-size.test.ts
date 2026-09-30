import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { THEME_MANIFESTS } from '../../src/themes/manifests';
import { homePageLimit } from '../../src/themes/page-size';

const leads = { leadsFirstPage: true, pageSize: 6 };

test('a theme that leads with the newest post asks for one more on the first page of an unsearched list', () => {
  assert.equal(homePageLimit({ ...leads, cursor: undefined, query: undefined }), 7, 'the lead and six below it');
});

test('every other page keeps the normal size', () => {
  assert.equal(homePageLimit({ ...leads, cursor: 'abc', query: undefined }), 6, 'a later page has no lead');
  assert.equal(homePageLimit({ ...leads, cursor: undefined, query: 'compost' }), 6, 'results are not a front page');
  assert.equal(homePageLimit({ leadsFirstPage: false, pageSize: 6, cursor: undefined, query: undefined }), 6, 'a theme with no lead');
  assert.equal(homePageLimit({ leadsFirstPage: undefined, pageSize: 12, cursor: undefined, query: undefined }), 12);
});

test('Plain says it leads, and Paper does not', () => {
  const flag = (id: string) => THEME_MANIFESTS.find((manifest) => manifest.id === id)?.leadsFirstPage;
  assert.equal(flag('plain'), true);
  assert.equal(flag('paper'), undefined);
});

test('the home route reads the decision, and the list keeps its cursors tied to the normal size', () => {
  const route = readFileSync(new URL('../../src/pages/[locale]/index.astro', import.meta.url), 'utf8');
  assert.match(route, /const take = homePageLimit\(/);
  assert.match(route, /q: query, take \}/);
  assert.match(route, /limit: PAGE_SIZE/);
  const published = readFileSync(new URL('../../src/server/content/published.ts', import.meta.url), 'utf8');
  assert.match(published, /const cursorQuery: CursorQuery = \{ category: input\.category, limit, /, 'the cursor is tied to limit, not take');
});
