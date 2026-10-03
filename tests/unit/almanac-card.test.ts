import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cardMeta, cardPanel, heroLink } from '../../src/themes/almanac/home';
import { tone } from '../../src/themes/almanac/tone';
import type { ThemeHomePost } from '../../src/themes/contract';
import type { PostCategoryBadge } from '../../src/types/cms';

/** A post as the home route hands it over: the route's posts carry their categories. */
const post = (categories?: PostCategoryBadge[]) => ({ categories, id: 'p1', title: 'A title' }) as unknown as ThemeHomePost;

test('a card with no cover takes its band\'s name and tone from the first category', () => {
  const design = { id: '6f1c2a90-3d4b-4e5f-8a7b-1c2d3e4f5a6b', name: 'design notes' };
  const panel = cardPanel(post([design, { id: 'other', name: 'Zebra' }]), 'Tome');
  assert.deepEqual(panel, { name: 'design notes', tone: tone(design.id) });
});

test('a Thai category is named whole, as it is written', () => {
  assert.equal(cardPanel(post([{ id: 'c', name: 'สูตรขนม' }]), 'Tome').name, 'สูตรขนม');
  assert.equal(cardPanel(post([{ id: 'c', name: '  เทคโนโลยี ' }]), 'Tome').name, 'เทคโนโลยี');
});

test('a post with no category falls back to the site name, in one tone for all of them', () => {
  // The server files a post with no category chosen under the default, so this is a post read
  // without its categories: the band still says something.
  assert.deepEqual(cardPanel(post([]), 'tome notes'), { name: 'tome notes', tone: tone('') });
  assert.deepEqual(cardPanel(post(), 'บันทึก'), { name: 'บันทึก', tone: tone('') });
  // A category with no name is no name: the site name speaks instead.
  assert.equal(cardPanel(post([{ id: 'c', name: '   ' }]), 'Tome').name, 'Tome');
});

test('the meta line is the reading time and the day, in the page\'s language and the site\'s time zone', () => {
  const now = new Date('2026-10-02T00:00:00Z');
  const line = (meta: { date: string; reading: string }) => `${meta.reading} · ${meta.date}`;
  assert.equal(line(cardMeta(5, '2026-09-28T09:00:00Z', 'en', 'UTC', now)), '5 min read · 28 Sep');
  assert.equal(line(cardMeta(5, '2026-09-28T09:00:00Z', 'th', 'UTC', now)), 'อ่าน 5 นาที · 28 ก.ย.');
  // 20:00 in UTC is already the next morning in Bangkok.
  assert.equal(cardMeta(1, '2026-09-28T20:00:00Z', 'en', 'Asia/Bangkok', now).date, '29 Sep');
  assert.equal(cardMeta(1, '2026-09-28T20:00:00Z', 'en', 'America/New_York', now).date, '28 Sep');
});

test('a post from another year says which year', () => {
  const now = new Date('2026-10-02T00:00:00Z');
  assert.equal(cardMeta(2, '2024-03-05T12:00:00Z', 'en', 'UTC', now).date, '5 Mar 2024');
  assert.equal(cardMeta(2, '2024-03-05T12:00:00Z', 'th', 'UTC', now).date, '5 มี.ค. 2567');
});

test('a hero link is a path on this site or an https address; anything else drops its button', () => {
  assert.equal(heroLink('/about', null), '/about');
  assert.equal(heroLink('  /en/blog/hello  ', null), '/en/blog/hello');
  assert.equal(heroLink('https://example.org/a?b=1', null), 'https://example.org/a?b=1');
  for (const bad of ['javascript:alert(1)', '//evil.example', 'http://example.org', 'mailto:a@b.c', 'about', '/a b', 'data:text/html,x']) {
    assert.equal(heroLink(bad, '/fallback'), null, `${bad} is refused`);
  }
});

test('a hero link left blank goes where the theme would send it, or nowhere when there is nowhere', () => {
  assert.equal(heroLink('', '/en/blog/newest'), '/en/blog/newest');
  assert.equal(heroLink('   ', '/en#posts'), '/en#posts');
  assert.equal(heroLink(undefined, '/en#posts'), '/en#posts');
  assert.equal(heroLink('', null), null);
});
