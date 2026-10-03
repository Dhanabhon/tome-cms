import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { CliContext } from '../../src/cli/main.js';
import { tome } from '../../src/cli/main.js';
import { localTime } from '../../src/cli/output.js';
import type { SocketAnswer } from '../../src/cli/socket.js';
import { fakeContext, requestId, statusAnswer, updateJob } from '../helpers/cli-context.js';

type Fake = ReturnType<typeof fakeContext>;
const run = (f: Fake, argv: string[]) => tome(argv, { uid: 0, load: async () => f.context, print: f.context.print, warn: f.context.warn });
const posts = (f: Fake) => f.calls.filter((call) => call.method === 'POST' && call.path === '/v1/restore');

const backupName = 'tomecms-20261001T100000000Z';

/** A backup root with one backup in it, and the site's env file beside it. Removed after the test. */
function server(t: { after: (fn: () => void) => void }, manifest: Record<string, unknown> = {}) {
  const base = mkdtempSync(join(tmpdir(), 'tome-restore-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'backups');
  const backup = join(root, backupName);
  mkdirSync(backup, { recursive: true });
  writeFileSync(join(backup, 'manifest.json'), JSON.stringify({
    format: 'tomecms-backup', version: 1, createdAt: '2026-10-01T10:00:00.000Z', applicationVersion: '1.13.0',
    config: { publicUrl: 'https://example.com', database: 'tomecms', s3Endpoint: 'http://seaweedfs:8333', bucket: 'tomecms' },
    database: { file: 'database.dump', sha256: 'b'.repeat(64) },
    records: { siteSettings: 1, posts: 12, pages: 3, mediaItems: 40 },
    objects: [],
    ...manifest,
  }));
  writeFileSync(join(backup, 'database.dump'), 'dump');
  const environmentFile = join(base, 'tome-cms.env');
  writeFileSync(environmentFile, 'TOME_CMS_PUBLIC_URL=https://example.com\n');
  return { base, root, backup, realBackup: realpathSync(backup), environmentFile };
}

type Server = ReturnType<typeof server>;

/** A restore record as `GET /v1/restore` shows it. */
function restoreRecord(site: Server, phase: string, patch: Record<string, unknown> = {}) {
  const ended = phase === 'succeeded' || phase === 'failed';
  return {
    id: requestId, phase, startedAt: '2026-10-02T11:00:00.000Z', finishedAt: ended ? '2026-10-02T11:05:00.000Z' : null,
    backupDirectory: site.realBackup, safetyBackupDirectory: null, migrated: false, errorCode: null, report: null,
    maintenanceKept: false, ...patch,
  };
}

const safety = '/var/backups/tome-cms/tomecms-20261002T110100000Z';
const report = (patch: Record<string, unknown> = {}) => ({
  records: { siteSettings: 1, posts: 12, pages: 3, mediaItems: 40 }, sealedSecrets: 2, unopenedSecrets: [], ...patch,
});

/** A context on `site`, whose commands are recorded in `events` beside the socket calls. */
function restoreContext(site: Server, input: {
  routes?: Record<string, Array<SocketAnswer | ((body: unknown) => SocketAnswer)>>;
  version?: string;
  overrides?: Partial<CliContext>;
} = {}) {
  const events: string[] = [];
  const commands: Array<{ executable: string; args: readonly string[] }> = [];
  const f = fakeContext({
    config: { backupDirectory: site.root, environmentFile: site.environmentFile },
    routes: {
      'GET /v1/status': [statusAnswer(null, input.version ?? '1.13.0')],
      'POST /v1/restore': [() => { events.push('POST'); return { status: 202, body: { id: requestId, phase: 'verifying' } }; }],
      'GET /v1/restore': [{ status: 200, body: restoreRecord(site, 'succeeded', { safetyBackupDirectory: safety, report: report() }) }],
      ...input.routes,
    },
    overrides: {
      runCommand: async (executable, args) => {
        events.push(executable);
        commands.push({ executable, args });
        return { code: 0, stdout: '', stderr: '' };
      },
      ...input.overrides,
    },
  });
  return { ...f, events, commands };
}

// --- refusals -----------------------------------------------------------------------------------

test('a directory that is not a backup under the backup root is refused, and nothing is sent', async (t) => {
  const site = server(t);
  const outside = join(site.base, 'elsewhere');
  mkdirSync(outside);
  symlinkSync(outside, join(site.root, 'link'));
  for (const path of [outside, site.root, join(site.root, 'missing'), join(site.root, 'link'), join(site.backup, 'manifest.json')]) {
    const f = restoreContext(site);
    assert.equal(await run(f, ['restore', path, '--yes']), 1, path);
    assert.equal(f.err(), 'That is not a backup directory under /var/backups/tome-cms.', path);
    assert.equal(posts(f).length, 0);
    assert.deepEqual(f.events, []);
  }
});

test('a backup with no manifest is refused', async (t) => {
  const site = server(t);
  rmSync(join(site.backup, 'manifest.json'));
  const f = restoreContext(site);
  assert.equal(await run(f, ['restore', site.backup, '--yes']), 1);
  assert.equal(f.err(), 'That backup has no manifest.json, so it was cut off or is not a TomeCMS backup.');
  assert.deepEqual(f.events, []);
});

test('a backup whose manifest does not read is refused as not passing its checks', async (t) => {
  const site = server(t, { format: 'something-else' });
  const f = restoreContext(site);
  assert.equal(await run(f, ['restore', site.backup, '--yes']), 1);
  assert.match(f.err(), /did not pass its checks.*nothing was changed/);
  assert.deepEqual(f.events, []);
});

test('a backup made for another address is refused: a restore keeps the site\'s address', async (t) => {
  const site = server(t, { config: { publicUrl: 'https://other.example/blog', database: 'tomecms', s3Endpoint: 'http://seaweedfs:8333', bucket: 'tomecms' } });
  const f = restoreContext(site);
  assert.equal(await run(f, ['restore', site.backup, '--yes']), 1);
  assert.equal(f.err(), 'That backup is from https://other.example, and this site is https://example.com. A restore keeps the site\'s address.');
  assert.deepEqual(f.events, []);
});

test('a backup from a newer TomeCMS is refused, with the update that would take it', async (t) => {
  const site = server(t, { applicationVersion: '1.14.0' });
  const f = restoreContext(site);
  assert.equal(await run(f, ['restore', site.backup, '--yes']), 1);
  assert.equal(f.err(), 'That backup is from TomeCMS 1.14.0, newer than this site\'s 1.13.0. Update the site to 1.14.0 first: sudo tome update 1.14.0');
  assert.deepEqual(f.events, []);
});

test('a site older than 1.13.0 cannot restore, and is told to update', async (t) => {
  const site = server(t, { applicationVersion: '1.12.0' });
  const f = restoreContext(site, { version: '1.12.0' });
  assert.equal(await run(f, ['restore', site.backup, '--yes']), 1);
  assert.equal(f.err(), 'This site runs TomeCMS 1.12.0. Restore needs 1.13.0 or newer: sudo tome update');
  assert.deepEqual(f.events, []);
});

test('an updater older than 1.6.0 cannot restore, and is told how to upgrade it', async (t) => {
  const site = server(t);
  const old = statusAnswer(null, '1.13.0');
  const f = restoreContext(site, { routes: { 'GET /v1/status': [{ ...old, body: { ...(old.body as object), updaterVersion: '1.5.0' } }] } });
  assert.equal(await run(f, ['restore', site.backup, '--yes']), 1);
  assert.equal(f.err(), 'The updater is 1.5.0. Restore needs updater 1.6.0: run sudo npm run updater:upgrade from a v1.13.0 checkout.');
  assert.deepEqual(f.events, []);
});

// --- asking -------------------------------------------------------------------------------------

test('restore says what the backup holds and what it replaces, then asks; no changes nothing', async (t) => {
  const site = server(t);
  const f = restoreContext(site, { overrides: { confirm: async (question) => { f.prompts.push(question); return false; } } });
  assert.equal(await run(f, ['restore', site.backup]), 1);
  assert.deepEqual(f.printed, [
    `Backup: ${site.realBackup}`,
    `Made ${localTime('2026-10-01T10:00:00.000Z')} by TomeCMS 1.13.0, for https://example.com.`,
    'It holds the database and media: 12 posts, 3 pages, 40 media items.',
    'Everything on this site will be replaced by the backup.',
    'Nothing was done.',
  ]);
  assert.deepEqual(f.prompts, ['Restore this backup? [y/N] ']);
  assert.equal(posts(f).length, 0);
  assert.deepEqual(f.events, [], 'no chown before the owner says yes');
});

test('a database-only backup says the media stay as they are', async (t) => {
  const site = server(t, { scope: 'database' });
  const f = restoreContext(site, { overrides: { confirm: async () => false } });
  assert.equal(await run(f, ['restore', site.backup]), 1);
  assert.match(f.out(), /^It holds the database only: 12 posts, 3 pages, 40 media items\.$/m);
  assert.match(f.out(), /^Everything in this site's database will be replaced by the backup; its media stay as they are\.$/m);
});

test('--yes does not ask, and a relative path is taken by its real path', async (t) => {
  const site = server(t);
  const f = restoreContext(site);
  const cwd = process.cwd();
  process.chdir(site.root);
  t.after(() => process.chdir(cwd));
  assert.equal(await run(f, ['restore', backupName, '--yes']), 0);
  assert.equal(f.prompts.length, 0);
  assert.deepEqual(posts(f)[0]!.body, { requestId, backupDirectory: site.realBackup });
});

// --- ownership (Review Focus 1) -----------------------------------------------------------------

test('before it asks the updater, the backup is handed to the owner of the backup root, links not followed', async (t) => {
  // A backup copied in by rsync as root arrives root-owned; the job runs as the root's owner.
  const site = server(t);
  const owner = statSync(site.root);
  const f = restoreContext(site);
  assert.equal(await run(f, ['restore', site.backup, '--yes']), 0);
  assert.deepEqual(f.commands, [{ executable: 'chown', args: ['-R', '--no-dereference', `${owner.uid}:${owner.gid}`, site.realBackup] }]);
  assert.deepEqual(f.events, ['chown', 'POST'], 'chown runs before the POST');
});

test('a chown that fails stops the restore before anything is sent', async (t) => {
  const site = server(t);
  const f = restoreContext(site, { overrides: { runCommand: async () => ({ code: 1, stdout: '', stderr: 'chown: Operation not permitted' }) } });
  assert.equal(await run(f, ['restore', site.backup, '--yes']), 1);
  assert.match(f.err(), /could not be handed to the updater/);
  assert.equal(posts(f).length, 0);
});

// --- following and the end ----------------------------------------------------------------------

test('restore follows the job a step at a time out of seven, then prints what came back', async (t) => {
  const site = server(t, { applicationVersion: '1.12.0' });
  const f = restoreContext(site, {
    routes: {
      'GET /v1/restore': [
        ...['verifying', 'quiescing', 'safety_backup', 'safety_backup', 'restoring', 'migrating', 'restarting', 'checking']
          .map((phase) => ({ status: 200, body: restoreRecord(site, phase) })),
        { status: 200, body: restoreRecord(site, 'succeeded', { safetyBackupDirectory: safety, migrated: true, report: report() }) },
      ],
    },
  });
  assert.equal(await run(f, ['restore', site.backup, '--yes']), 0);
  assert.deepEqual(f.printed.slice(4), [
    '[1/7] Check the backup',
    '[2/7] Prepare maintenance',
    '[3/7] Create the safety backup',
    '[4/7] Restore the backup',
    '[5/7] Apply database migrations',
    '[6/7] Restart TomeCMS',
    '[7/7] Check the restored site',
    'Restored: 12 posts, 3 pages, 40 media items.',
    'Migrations ran.',
    `The site as it was before the restore is kept in ${safety}.`,
  ]);
  assert.equal(f.err(), '');
});

test('a backup at the same version skips the migration step, and does not say migrations ran', async (t) => {
  const site = server(t);
  const f = restoreContext(site, {
    routes: {
      'GET /v1/restore': [
        ...['restoring', 'restarting'].map((phase) => ({ status: 200, body: restoreRecord(site, phase) })),
        { status: 200, body: restoreRecord(site, 'succeeded', { safetyBackupDirectory: safety, report: report() }) },
      ],
    },
  });
  assert.equal(await run(f, ['restore', site.backup, '--yes']), 0);
  assert.match(f.out(), /\[4\/7\] Restore the backup\n\[6\/7\] Restart TomeCMS\n/);
  assert.doesNotMatch(f.out(), /Migrations ran/);
});

test('plugin settings this server cannot open are listed, with new recovery codes to issue', async (t) => {
  const site = server(t);
  const f = restoreContext(site, {
    routes: {
      'GET /v1/restore': [{ status: 200, body: restoreRecord(site, 'succeeded', {
        safetyBackupDirectory: safety,
        report: report({ unopenedSecrets: [{ plugin: 'turnstile', setting: 'secretKey' }, { plugin: 'mailer\u001b[2J', setting: 'apiKey' }] }),
      }) }],
    },
  });
  assert.equal(await run(f, ['restore', site.backup, '--yes']), 0);
  assert.match(f.out(), /could not be opened on this server.*\n {2}turnstile: secretKey\n {2}mailer\[2J: apiKey\n/);
  assert.match(f.out(), /^Issue new recovery codes under Security: the ones you have were made on the old server\.$/m);
});

test('with no sealed secrets at all, one line says what to do if the backup came from another server', async (t) => {
  const site = server(t);
  const ended = (sealedSecrets: number) => restoreContext(site, {
    routes: { 'GET /v1/restore': [{ status: 200, body: restoreRecord(site, 'succeeded', { safetyBackupDirectory: safety, report: report({ sealedSecrets }) }) }] },
  });
  const none = ended(0);
  assert.equal(await run(none, ['restore', site.backup, '--yes']), 0);
  assert.equal(none.printed.at(-1), 'If this backup came from another server, issue new recovery codes under Security.');
  assert.doesNotMatch(none.out(), /could not be opened/);
  const opened = ended(2);
  assert.equal(await run(opened, ['restore', site.backup, '--yes']), 0);
  assert.doesNotMatch(opened.out(), /recovery codes/);
});

test('each way a restore can fail is said in a plain sentence', async (t) => {
  const site = server(t);
  const expected: Record<string, RegExp> = {
    backup_invalid: /did not pass its checks.*nothing was changed/,
    backup_other_site: /another site.*keeps the site's address/,
    backup_too_new: /newer TomeCMS.*sudo tome update/,
    app_too_old: /older than 1\.13\.0.*sudo tome update/,
    insufficient_disk_space: /Not enough free disk space.*sudo tome prune/,
    safety_backup_failed: /safety backup.*failed.*nothing was replaced/,
    restore_failed: /restore failed.*safety backup was put back/,
    rollback_failed: /could not be put back either.*stays in maintenance/,
    interrupted: /updater stopped.*put the site back as it was/,
    preflight_failed: /did not start.*Nothing was changed.*sudo tome logs updater/,
  };
  for (const [code, sentence] of Object.entries(expected)) {
    const f = restoreContext(site, {
      routes: { 'GET /v1/restore': [{ status: 200, body: restoreRecord(site, 'failed', { errorCode: code, maintenanceKept: code === 'rollback_failed' }) }] },
    });
    assert.equal(await run(f, ['restore', site.backup, '--yes']), 1, code);
    assert.match(f.err(), sentence, code);
  }
});

test('a restore that could not fall back names both directories, and the steps out of maintenance', async (t) => {
  const site = server(t);
  const f = restoreContext(site, {
    routes: { 'GET /v1/restore': [{ status: 200, body: restoreRecord(site, 'failed', {
      errorCode: 'rollback_failed', safetyBackupDirectory: `${safety}\u001b[31m`, maintenanceKept: true,
    }) }] },
  });
  assert.equal(await run(f, ['restore', site.backup, '--yes']), 1);
  const err = f.err();
  assert.match(err, /stays in maintenance, and the app is stopped/);
  assert.match(err, /no one knows what state the database is in/);
  assert.ok(err.includes(site.realBackup), 'the backup');
  assert.ok(err.includes(`${safety}[31m`) && !err.includes('\u001b'), 'the safety backup, printable');
  assert.match(err, /From a checkout of v1\.13\.0 or newer, run: sudo npm run updater:clear-failed/);
  assert.ok(err.includes(`sudo tome restore ${safety}[31m`), 'then the safety backup is put back');
});

test('a restore that found the site stopped and failed keeps it stopped, and says how to go on', async (t) => {
  const site = server(t);
  const failed = (errorCode: string, safetyBackupDirectory: string | null) => restoreContext(site, {
    routes: { 'GET /v1/restore': [{ status: 200, body: restoreRecord(site, 'failed', { errorCode, safetyBackupDirectory, maintenanceKept: true }) }] },
  });
  const rolledBack = failed('restore_failed', safety);
  assert.equal(await run(rolledBack, ['restore', site.backup, '--yes']), 1);
  assert.match(rolledBack.err(), /safety backup was put back, so the database is as it was before the restore/);
  assert.match(rolledBack.err(), /sudo npm run updater:clear-failed/);
  assert.ok(rolledBack.err().includes(`sudo tome restore ${safety}`));

  const noSafety = failed('safety_backup_failed', null);
  assert.equal(await run(noSafety, ['restore', site.backup, '--yes']), 1);
  assert.match(noSafety.err(), /Nothing was replaced/);
  assert.match(noSafety.err(), /There is no safety backup\./);
  assert.match(noSafety.err(), /restore the newest backup.*sudo tome status shows it/);
});

test('a failure that did not keep maintenance prints no recovery steps', async (t) => {
  const site = server(t);
  const f = restoreContext(site, {
    routes: { 'GET /v1/restore': [{ status: 200, body: restoreRecord(site, 'failed', { errorCode: 'restore_failed', safetyBackupDirectory: safety }) }] },
  });
  assert.equal(await run(f, ['restore', site.backup, '--yes']), 1);
  assert.doesNotMatch(f.err(), /clear-failed/);
});

// --- refused by the updater ---------------------------------------------------------------------

test('a restore refused because an earlier one kept the site in maintenance prints the way out', async (t) => {
  const site = server(t);
  const f = restoreContext(site, {
    routes: {
      'POST /v1/restore': [{ status: 409, body: { error: 'manual_recovery_required' } }],
      'GET /v1/restore': [{ status: 200, body: restoreRecord(site, 'failed', { errorCode: 'rollback_failed', safetyBackupDirectory: safety, maintenanceKept: true }) }],
    },
  });
  assert.equal(await run(f, ['restore', site.backup, '--yes']), 1);
  assert.match(f.err(), /An earlier restore failed and keeps the site in maintenance/);
  assert.match(f.err(), /sudo npm run updater:clear-failed/);
  assert.ok(f.err().includes(`sudo tome restore ${safety}`));
});

test('a restore refused because an update needs manual recovery says so', async (t) => {
  const site = server(t);
  const f = restoreContext(site, {
    routes: {
      'POST /v1/restore': [{ status: 409, body: { error: 'manual_recovery_required' } }],
      'GET /v1/restore': [{ status: 404, body: { error: 'not_found' } }],
    },
  });
  assert.equal(await run(f, ['restore', site.backup, '--yes']), 1);
  assert.match(f.err(), /The last update needs manual recovery/);
});

test('a restore refused for disk space names tome prune', async (t) => {
  const site = server(t);
  const f = restoreContext(site, { routes: { 'POST /v1/restore': [{ status: 409, body: { error: 'insufficient_disk_space' } }] } });
  assert.equal(await run(f, ['restore', site.backup, '--yes']), 1);
  assert.match(f.err(), /Not enough free disk space.*sudo tome prune/);
});

test('a 409 while a restore runs is busy and not tried again; once none runs, it is', async (t) => {
  const site = server(t);
  const busy = restoreContext(site, {
    routes: {
      'POST /v1/restore': [{ status: 409, body: { error: 'update_in_progress' } }],
      'GET /v1/status': [statusAnswer(null, '1.13.0'), statusAnswer(updateJob('succeeded'), '1.13.0')],
      'GET /v1/backup': [{ status: 404, body: { error: 'not_found' } }],
      'GET /v1/restore': [{ status: 200, body: { ...restoreRecord(site, 'restoring'), id: '33333333-3333-4333-8333-333333333333' } }],
    },
  });
  assert.equal(await run(busy, ['restore', site.backup, '--yes']), 1);
  assert.equal(posts(busy).length, 1);
  assert.equal(busy.err(), 'An update, a backup, a restore or an image clean-up is running. Wait for it to finish, then try again.');

  const late = restoreContext(site, {
    routes: {
      'POST /v1/restore': [{ status: 409, body: { error: 'update_in_progress' } }, { status: 202, body: { id: requestId, phase: 'verifying' } }],
      'GET /v1/status': [statusAnswer(null, '1.13.0'), statusAnswer(updateJob('succeeded'), '1.13.0')],
      'GET /v1/backup': [{ status: 404, body: { error: 'not_found' } }],
      'GET /v1/restore': [
        { status: 200, body: { ...restoreRecord(site, 'succeeded'), id: '33333333-3333-4333-8333-333333333333' } },
        { status: 200, body: restoreRecord(site, 'succeeded', { safetyBackupDirectory: safety, report: report() }) },
      ],
    },
  });
  assert.equal(await run(late, ['restore', site.backup, '--yes']), 0);
  assert.equal(posts(late).length, 2);
});
