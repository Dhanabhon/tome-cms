import assert from 'node:assert/strict';
import test from 'node:test';

import { formatPublishedAt, installabilityReason, updateCheckMessage } from '../../src/components/admin/UpdateManager.tsx';
import { adminCopy, fill } from '../../src/lib/admin-i18n.js';
import { getUpdateInstallability, updateActionSchema } from '../../src/server/update/admin.js';

test('accepts only check or one exact stable target', () => {
  assert.deepEqual(updateActionSchema.parse({ action: 'check' }), { action: 'check' });
  assert.deepEqual(updateActionSchema.parse({ action: 'apply', version: '1.0.1' }), { action: 'apply', version: '1.0.1' });
  for (const value of [
    { action: 'apply', version: 'latest' },
    { action: 'apply', version: '1.0.1', image: 'evil' },
    { action: 'run', command: 'docker' },
  ]) assert.throws(() => updateActionSchema.parse(value));
});

test('keeps check-only installation capability distinct from release availability', () => {
  assert.deepEqual(getUpdateInstallability('check-only'), {
    mode: 'check-only',
    installable: false,
    reason: 'This installation is configured for update checks only.',
  });
});

test('uses a safe publication-date fallback for malformed release metadata', () => {
  assert.equal(formatPublishedAt('not-a-date', adminCopy('en')), 'Publication date unavailable');
  // The fallback must follow the owner's language, not leak English into a Thai dashboard.
  assert.equal(formatPublishedAt('not-a-date', adminCopy('th'), 'th'), adminCopy('th').updates.publishedUnavailable);
  assert.match(formatPublishedAt('not-a-date', adminCopy('th'), 'th'), /[฀-๿]/);
});

test('formats a valid publication date in the owner language', () => {
  const moment = '2026-09-14T00:00:00.000Z';
  assert.notEqual(formatPublishedAt(moment, adminCopy('th'), 'th'), formatPublishedAt(moment, adminCopy('en'), 'en'));
});

test('every outcome of a check is said in the owner’s language, from the code the server sends', () => {
  const latest = { publishedAt: '2026-09-20T10:00:00Z', manifest: { version: '1.0.1', releaseNotesUrl: '' } };
  for (const locale of ['en', 'th'] as const) {
    const copy = adminCopy(locale);
    assert.equal(updateCheckMessage(copy, { availability: 'current', latest }), copy.updates.upToDate);
    assert.equal(updateCheckMessage(copy, { availability: 'available', latest }), fill(copy.updates.versionAvailable, { version: '1.0.1' }));
    assert.equal(updateCheckMessage(copy, { availability: 'manual-transition', latest }), copy.updates.manualTransitionRequired);
    assert.equal(updateCheckMessage(copy, { availability: 'unavailable', latest: null, reason: 'no-release' }), copy.updates.noRelease);
    assert.equal(updateCheckMessage(copy, { availability: 'unavailable', latest: null, reason: 'unreachable' }), copy.updates.releaseUnreachable);
    assert.equal(updateCheckMessage(copy, { availability: 'unavailable', latest: null, reason: 'unusable' }), copy.updates.releaseUnusable);
    assert.equal(updateCheckMessage(copy, { availability: 'unavailable', latest: null }), copy.updates.updateCheckUnavailable,
      'a server that sends no reason still gets a sentence');

    const checkOnly = { installability: getUpdateInstallability('check-only'), updateMode: 'check-only' as const };
    assert.equal(installabilityReason(copy, checkOnly), copy.updates.checkOnly, 'the server’s English line is not shown');
    assert.equal(installabilityReason(copy, null), copy.updates.checkOnly, 'nor before the first answer');
  }
  const th = adminCopy('th').updates;
  assert.equal(new Set([th.noRelease, th.releaseUnreachable, th.releaseUnusable]).size, 3, 'three causes, three sentences');
});
