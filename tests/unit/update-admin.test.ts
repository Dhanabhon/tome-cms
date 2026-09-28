import assert from 'node:assert/strict';
import test from 'node:test';

import { formatBackupTime, formatPublishedAt, progressVisible, installabilityReason, jobStatusMessage, updateCheckFailureMessage, updateCheckMessage, updateModeLabel } from '../../src/components/admin/UpdateManager.tsx';
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
    code: 'check-only',
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

test('a failed check never shows the server’s, fetch’s or an abort’s own English', () => {
  const copy = adminCopy('en');
  assert.equal(updateCheckFailureMessage(copy, { status: 429 } as Response), copy.auth.tooManyAttempts,
    'the 7th check in 10 minutes gets a 429, said as too many attempts');
  assert.equal(updateCheckFailureMessage(copy, { status: 500 } as Response), copy.updates.updateCheckUnavailable,
    'any other status is the generic unavailable sentence');
  assert.equal(updateCheckFailureMessage(copy, null), copy.updates.updateCheckUnavailable,
    'a thrown error with no response, such as a client abort, is the same generic sentence');
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

    // On a managed install, each reason the server gives is said from its code, never its English line.
    const managed = (code: string) => ({ installability: { mode: 'managed' as const, installable: code === 'installable', reason: 'English', code }, updateMode: 'managed' as const });
    for (const [code, text] of [
      ['manual-recovery', copy.updates.contactOperator],
      ['in-progress', copy.updates.updateInProgress],
      ['no-update', copy.updates.noCompatibleUpdate],
      ['manual-upgrade', copy.updates.manualUpgrade],
      ['installable', copy.updates.readyToInstall],
    ] as const) {
      assert.equal(installabilityReason(copy, managed(code) as never), text, code);
    }
  }
  const th = adminCopy('th').updates;
  assert.equal(new Set([th.noRelease, th.releaseUnreachable, th.releaseUnusable]).size, 3, 'three causes, three sentences');
});

test('the update mode shows as words, never the raw check-only / managed value the server sends', () => {
  for (const locale of ['en', 'th'] as const) {
    const copy = adminCopy(locale);
    assert.equal(updateModeLabel(copy, 'check-only'), copy.updates.modeCheckOnly);
    assert.equal(updateModeLabel(copy, 'managed'), copy.updates.modeManaged);
    assert.notEqual(updateModeLabel(copy, 'check-only'), 'check-only', 'never the raw config enum');
    assert.notEqual(updateModeLabel(copy, 'managed'), 'managed', 'never the raw config enum');
  }
});

test('the progress line and the backup time are in the owner’s language, never the updater’s English', () => {
  for (const locale of ['en', 'th'] as const) {
    const copy = adminCopy(locale);
    const said = (phase: string) => jobStatusMessage(copy, { phase } as never);
    assert.equal(said('backing_up'), copy.updates.createBackup, 'a running step is its own label');
    assert.equal(said('succeeded'), copy.updates.updateSucceeded);
    assert.equal(said('rolling_back'), copy.updates.rollingBack);
    assert.equal(said('rolled_back'), copy.updates.previousRestored);
    assert.equal(said('failed_manual_recovery'), copy.updates.manualRecoveryRequired);
  }
  assert.notEqual(jobStatusMessage(adminCopy('th'), { phase: 'succeeded' } as never), 'Update installed successfully.');
  const when = '2026-09-28T08:22:24.000Z';
  assert.match(formatBackupTime(when, 'th'), /2569/, 'Thai shows the Buddhist year');
  assert.match(formatBackupTime(when, 'en'), /2026/);
  assert.equal(formatBackupTime('not-a-date', 'th'), 'not-a-date');
});

test('the progress card shows while an update runs; a finished one leaves only a summary', () => {
  assert.equal(progressVisible(false, null), false);
  assert.equal(progressVisible(true, null), true, 'just requested, before the updater answers');
  assert.equal(progressVisible(false, { phase: 'backing_up' } as never), true);
  for (const phase of ['succeeded', 'rolled_back', 'failed_manual_recovery']) {
    assert.equal(progressVisible(false, { phase } as never), false, phase);
    assert.equal(progressVisible(true, { phase } as never), true, `${phase}, while the owner watches it finish`);
  }
});
