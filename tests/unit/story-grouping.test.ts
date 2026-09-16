import assert from 'node:assert/strict';
import { test } from 'node:test';

import { groupAdminStories } from '../../src/lib/posts';
import type { PostLocale } from '../../src/types/cms';

const edition = (id: string, locale: PostLocale, group: string, updated: string) => ({
  id, locale, translation_group_id: group, updated_at: updated,
});

const TH_ABOUT = edition('a-th', 'th', 'about', '2026-09-10T00:00:00Z');
const EN_ABOUT = edition('a-en', 'en', 'about', '2026-09-12T00:00:00Z');
const TH_SOLO = edition('s-th', 'th', 'solo', '2026-09-14T00:00:00Z');
const ALL = [TH_ABOUT, EN_ABOUT, TH_SOLO];

test('a story carries every edition, not only the ones that matched', () => {
  // Filtering for English must not hide the Thai half: the card exists to show that
  // the two are one story, and half a pair is the one thing it must never claim.
  const stories = groupAdminStories(ALL, [EN_ABOUT], 'th');
  assert.equal(stories.length, 1);
  assert.deepEqual(stories[0].editions.map(({ id }) => id), ['a-th', 'a-en']);
});

test('the owner reads their own language first', () => {
  assert.equal(groupAdminStories(ALL, ALL, 'th')[0].primary.locale, 'th');
  const english = groupAdminStories(ALL, ALL, 'en').find(({ groupId }) => groupId === 'about');
  assert.equal(english?.primary.locale, 'en');
  assert.deepEqual(english?.editions.map(({ id }) => id), ['a-en', 'a-th']);
});

test('a story with one edition is still a story', () => {
  const [solo] = groupAdminStories(ALL, [TH_SOLO], 'th');
  assert.equal(solo.editions.length, 1);
  assert.equal(solo.primary.id, 's-th');
});

test('stories sort by whichever edition was touched last', () => {
  // 'solo' was updated on the 14th; 'about' has an edition from the 12th and one from
  // the 10th, so it follows. Sorting on the primary alone would invert the two.
  assert.deepEqual(groupAdminStories(ALL, ALL, 'th').map(({ groupId }) => groupId), ['solo', 'about']);
});

test('nothing matching means no stories', () => {
  assert.deepEqual(groupAdminStories(ALL, [], 'th'), []);
});

test('a missing owner locale still produces a stable order', () => {
  const stories = groupAdminStories(ALL, ALL, null);
  assert.deepEqual(stories.find(({ groupId }) => groupId === 'about')?.editions.map(({ id }) => id), ['a-th', 'a-en']);
});
