import assert from 'node:assert/strict';
import test from 'node:test';

import { homeSlidesSchema, slideStatus } from '../../src/lib/home-slides';

const now = new Date('2026-10-01T12:00:00Z');

test('a slide is live, waiting, ended or off, and its edges belong to one side', () => {
  const on = { enabled: true, endsAt: null, startsAt: null };
  assert.equal(slideStatus(on, now), 'live');
  assert.equal(slideStatus({ ...on, enabled: false }, now), 'off');
  assert.equal(slideStatus({ ...on, startsAt: '2026-10-01T12:00:01Z' }, now), 'waiting');
  assert.equal(slideStatus({ ...on, startsAt: '2026-10-01T12:00:00Z' }, now), 'live', 'a slide that starts this instant has started');
  assert.equal(slideStatus({ ...on, endsAt: '2026-10-01T12:00:00Z' }, now), 'ended', 'a slide that ends this instant has ended');
  assert.equal(slideStatus({ ...on, endsAt: '2026-10-01T12:00:01Z' }, now), 'live');
  assert.equal(slideStatus({ enabled: false, endsAt: '2020-01-01T00:00:00Z', startsAt: null }, now), 'off', 'off says more than ended');
});

const mediaId = '5f0c2a9e-3b1d-4c6e-9a8f-7b2d1e0c4a55';
const pageId = '0d9e8f7a-6b5c-4d3e-8f2a-1b0c9d8e7f6a';
const parse = (slides: unknown[]) => homeSlidesSchema.safeParse({ locale: 'th', slides });

test('a slide is shaped the way the table will take it', () => {
  const result = parse([{ mediaId: mediaId.toUpperCase(), heading: '  Hello  ', body: '', button: null }]);
  assert.ok(result.success);
  const [slide] = result.data.slides;
  assert.equal(slide.mediaId, mediaId, 'an id is kept in lower case');
  assert.equal(slide.heading, 'Hello', 'words are trimmed');
  assert.equal(slide.body, null, 'an empty body is no body');
  assert.deepEqual(
    { align: slide.align, enabled: slide.enabled, focus: slide.focus, overlay: slide.overlay },
    { align: 'start', enabled: true, focus: 'center', overlay: 'soft' },
    'what a slide is when nothing is said',
  );
});

test('a slide that breaks a rule is refused before it reaches the table', () => {
  const refuses = (why: string, slide: Record<string, unknown>) => assert.equal(parse([{ mediaId, ...slide }]).success, false, why);
  refuses('a heading over 80 characters', { heading: 'ก'.repeat(81) });
  refuses('a body over 200 characters', { body: 'ก'.repeat(201) });
  refuses('words on a bare picture', { heading: 'Words', overlay: 'none' });
  refuses('a button with no words on it', { button: { label: ' ', link: { kind: 'home' } } });
  refuses('a button label over 30 characters', { button: { label: 'ก'.repeat(31), link: { kind: 'home' } } });
  refuses('a page link to something that is not an id', { button: { label: 'Read', link: { kind: 'page', pageId: 'about' } } });
  refuses('a script for an address', { button: { label: 'Go', link: { kind: 'custom', url: 'javascript:alert(1)' } } });
  refuses('an end before its start', { startsAt: '2026-10-02T00:00:00Z', endsAt: '2026-10-01T00:00:00Z' });
  refuses('a focus point that is not one of the nine', { focus: 'middle' });
  refuses('a field the table does not have', { colour: 'red' });
  refuses('an end the same moment as its start', { startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-10-01T00:00:00Z' });
  refuses('a button with no link', { button: { label: 'Read' } });
  refuses('a page link that opens a new tab', { button: { label: 'Read', link: { kind: 'page', pageId, newTab: true } } });
  refuses('the home opening a new tab', { button: { label: 'Home', link: { kind: 'home', newTab: true } } });
  refuses('an alignment that is not one of the three', { align: 'justify' });
  refuses('an overlay that is not one of the three', { overlay: 'dark' });
  assert.equal(homeSlidesSchema.safeParse({ locale: 'de', slides: [] }).success, false, 'a language the site does not have');
  assert.equal(homeSlidesSchema.safeParse({ locale: 'th', slides: Array.from({ length: 11 }, () => ({ mediaId })) }).success, false, 'an eleventh slide');
  assert.equal(parse([{ mediaId, overlay: 'none' }]).success, true, 'a picture alone may be bare');
  assert.equal(parse([{ mediaId, button: { label: 'Read', link: { kind: 'page', pageId } } }]).success, true);
});
