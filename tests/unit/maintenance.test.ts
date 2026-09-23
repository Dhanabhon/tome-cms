import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_MAINTENANCE_WORDS,
  isAhead,
  maintenanceLocale,
  maintenanceNotice,
  maintenanceSchema,
  maintenanceStateSchema,
  maintenanceWords,
  parseMaintenanceCopy,
  retryAfter,
} from '../../src/lib/site-maintenance';

const picture = '0F8FAD5B-D9CB-469F-A165-70867728950E';

test('a maintenance page is refused when its template lacks what it draws', () => {
  assert.equal(maintenanceSchema.safeParse({ template: 'picture' }).success, false, 'Picture needs a picture');
  assert.equal(maintenanceSchema.safeParse({ template: 'countdown' }).success, false, 'Countdown needs a time');
  assert.equal(maintenanceSchema.safeParse({ template: 'video' }).success, false, 'only the four templates');
  assert.equal(maintenanceSchema.safeParse({ template: 'minimal', extra: true }).success, false, 'nothing else rides along');

  const parsed = maintenanceSchema.parse({ template: 'picture', mediaId: picture });
  assert.equal(parsed.mediaId, picture.toLowerCase(), 'an id is kept in lower case');
  assert.deepEqual(parsed.copy, {}, 'no words is allowed');
  assert.equal(parsed.backAt, null);
  assert.ok(maintenanceSchema.parse({ template: 'countdown', backAt: '2030-01-01T02:00:00.000Z' }));
});

test('words are trimmed, bounded, and fall back to the product\'s own in their language', () => {
  const parsed = maintenanceSchema.parse({ template: 'minimal', copy: { th: { heading: '  ปิดซ่อม  ', message: '' } } });
  assert.deepEqual(parsed.copy.th, { heading: 'ปิดซ่อม', message: '' });
  assert.equal(maintenanceSchema.safeParse({ template: 'minimal', copy: { en: { heading: 'x'.repeat(81) } } }).success, false, 'a heading over 80');
  assert.equal(maintenanceSchema.safeParse({ template: 'minimal', copy: { en: { message: 'x'.repeat(281) } } }).success, false, 'a message over 280');
  assert.equal(maintenanceSchema.safeParse({ template: 'minimal', copy: { de: { heading: 'Hallo' } } }).success, false, 'only the site\'s languages');

  assert.deepEqual(maintenanceWords(parsed.copy, 'th'), { heading: 'ปิดซ่อม', message: 'เราจะกลับมาเร็ว ๆ นี้' });
  assert.deepEqual(maintenanceWords({}, 'en'), DEFAULT_MAINTENANCE_WORDS.en);
  assert.deepEqual(DEFAULT_MAINTENANCE_WORDS.th, { heading: 'ปิดปรับปรุงชั่วคราว', message: 'เราจะกลับมาเร็ว ๆ นี้' });
  assert.deepEqual(DEFAULT_MAINTENANCE_WORDS.en, { heading: 'Down for maintenance', message: 'We\'ll be back soon.' });
});

test('stored words of the wrong shape read as none', () => {
  assert.deepEqual(parseMaintenanceCopy([]), {});
  assert.deepEqual(parseMaintenanceCopy(null), {});
  assert.deepEqual(parseMaintenanceCopy({ en: { heading: 'Back soon', message: '' } }), { en: { heading: 'Back soon', message: '' } });
});

test('a return time is ahead only while it has not come, and only then is it sent', () => {
  const now = new Date('2030-01-01T00:00:00.000Z');
  assert.equal(isAhead(null, now), false);
  assert.equal(isAhead('2030-01-01T00:00:00.000Z', now), false, 'a time equal to now has passed');
  assert.equal(isAhead(new Date('2030-01-01T00:00:01.000Z'), now), true);
  assert.equal(retryAfter('2030-01-01T02:00:00.000Z', now), 'Tue, 01 Jan 2030 02:00:00 GMT');
  assert.equal(retryAfter('2029-12-31T23:00:00.000Z', now), null);
  assert.equal(retryAfter(null, now), null);
});

test('the page speaks the language of its path, then of the API\'s query, then the site\'s', () => {
  const at = (path: string) => maintenanceLocale(new URL(path, 'https://example.com'), 'en');
  assert.equal(at('/th/'), 'th');
  assert.equal(at('/th/blog/a-post'), 'th');
  assert.equal(at('/en'), 'en');
  assert.equal(at('/'), 'en');
  assert.equal(at('/blog/legacy'), 'en');
  assert.equal(at('/api/v1/content/posts?locale=th'), 'th');
  assert.equal(at('/api/v1/content/posts?locale=de'), 'en');
  assert.equal(maintenanceLocale(new URL('https://example.com/'), 'th'), 'th');
});

test('the notice a headless site is given says what the page would', () => {
  const backAt = new Date('2030-01-01T02:00:00.000Z');
  assert.deepEqual(maintenanceNotice({ maintenance_back_at: backAt, maintenance_copy: { th: { heading: 'ปิดซ่อม', message: '' } } }, 'th'), {
    backAt: '2030-01-01T02:00:00.000Z', heading: 'ปิดซ่อม', locale: 'th', message: 'เราจะกลับมาเร็ว ๆ นี้',
  });
  assert.equal(maintenanceNotice({ maintenance_back_at: null, maintenance_copy: {} }, 'en').backAt, null);
});

test('the switch takes a flag and nothing else', () => {
  assert.deepEqual(maintenanceStateSchema.parse({ enabled: true }), { enabled: true });
  assert.equal(maintenanceStateSchema.safeParse({ enabled: 'yes' }).success, false);
  assert.equal(maintenanceStateSchema.safeParse({ enabled: true, template: 'logo' }).success, false);
});
