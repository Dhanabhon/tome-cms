import assert from 'node:assert/strict';
import test from 'node:test';

import { tome } from '../../src/cli/main.js';
import { NoOfficialReleaseError, ReleaseUnreachableError } from '../../src/server/update/releases.js';
import { backupRecord, fakeContext, requestId, statusAnswer, updateJob } from '../helpers/cli-context.js';

type Fake = ReturnType<typeof fakeContext>;
const run = (f: Fake, argv: string[]) => tome(argv, { uid: 0, load: async () => f.context, print: f.context.print, warn: f.context.warn });
const posts = (f: Fake, path: string) => f.calls.filter((call) => call.method === 'POST' && call.path === path);

// --- backup -------------------------------------------------------------------------------------

test('backup asks first, saying the site is in maintenance and for about how long the last one took', async () => {
  const f = fakeContext({
    routes: { 'GET /v1/backup': [{ status: 200, body: backupRecord('succeeded') }] },
    overrides: { confirm: async (question) => { f.prompts.push(question); return false; } },
  });
  assert.equal(await run(f, ['backup']), 1);
  assert.equal(f.prompts.length, 1);
  assert.match(f.prompts[0]!, /^Back up the database\? The site is in maintenance while it runs, about 3 minutes last time\. \[y\/N\] $/);
  assert.match(f.out(), /Nothing was done/);
  assert.equal(posts(f, '/v1/backup').length, 0);
});

test('backup --full --yes backs up everything without asking; the first backup has no estimate', async () => {
  const f = fakeContext({
    routes: {
      'GET /v1/backup': [{ status: 200, body: backupRecord('succeeded', { kind: 'full' }) }],
      'POST /v1/backup': [{ status: 202, body: { id: requestId, phase: 'quiescing' } }],
    },
  });
  assert.equal(await run(f, ['backup', '--full', '--yes']), 0);
  assert.equal(f.prompts.length, 0);
  assert.deepEqual(posts(f, '/v1/backup')[0]!.body, { requestId, kind: 'full' });
  const g = fakeContext({ routes: { 'GET /v1/backup': [{ status: 404, body: { error: 'not_found' } }] }, overrides: { confirm: async (question) => { g.prompts.push(question); return false; } } });
  await run(g, ['backup', '--full']);
  assert.match(g.prompts[0]!, /^Back up the database and media\? The site is in maintenance while it runs, for a few minutes\. \[y\/N\] $/);
});

test('backup follows the job step by step, then prints where the backup went and its size', async () => {
  const f = fakeContext({
    routes: {
      'GET /v1/backup': [
        ...['quiescing', 'backing_up', 'backing_up', 'restarting'].map((phase) => ({ status: 200, body: backupRecord(phase) })),
        { status: 200, body: backupRecord('succeeded') },
      ],
      'POST /v1/backup': [{ status: 202, body: { id: requestId, phase: 'quiescing' } }],
      // While it runs, the updater says its lock is held: not stuck.
      'GET /v1/busy': [{ status: 200, body: { busy: true } }],
    },
  });
  assert.equal(await run(f, ['backup', '--yes']), 0);
  assert.deepEqual(f.printed, [
    '[1/3] Prepare maintenance',
    '[2/3] Create the backup',
    '[3/3] Restart TomeCMS',
    'Backup saved to /var/backups/tome-cms/tomecms-20261002T110000000Z (12.0 MiB).',
  ]);
  assert.deepEqual(posts(f, '/v1/backup')[0]!.body, { requestId, kind: 'database' });
});

test('an app too old for a database-only backup is backed up in full, and the owner is told', async () => {
  const f = fakeContext({
    routes: {
      'GET /v1/backup': [{ status: 200, body: backupRecord('succeeded', { kind: 'full' }) }],
      'POST /v1/backup': [{ status: 202, body: { id: requestId, phase: 'quiescing' } }],
    },
  });
  assert.equal(await run(f, ['backup', '--yes']), 0);
  assert.match(f.out(), /backed up everything/);
});

test('a backup refused for disk space names tome prune', async () => {
  const f = fakeContext({
    routes: {
      'GET /v1/backup': [{ status: 404, body: { error: 'not_found' } }],
      'POST /v1/backup': [{ status: 409, body: { error: 'insufficient_disk_space' } }],
    },
  });
  assert.equal(await run(f, ['backup', '--yes']), 1);
  assert.match(f.err(), /Not enough free disk space where backups go \(\/var\/backups\/tome-cms\): it needs 5\.0 GiB\./);
  assert.match(f.err(), /sudo tome prune/);
});

test('each way a backup can fail is said in a plain sentence with what to do', async () => {
  const expected: Record<string, RegExp> = {
    preflight_failed: /did not start.*Nothing was stopped.*sudo tome logs updater/,
    backup_failed: /backup failed.*started again.*sudo tome logs updater/,
    health_failed: /did not become ready.*sudo tome logs app/,
  };
  for (const [code, sentence] of Object.entries(expected)) {
    const f = fakeContext({
      routes: {
        'GET /v1/backup': [{ status: 200, body: backupRecord('failed', { errorCode: code }) }],
        'POST /v1/backup': [{ status: 202, body: { id: requestId, phase: 'quiescing' } }],
      },
    });
    assert.equal(await run(f, ['backup', '--yes']), 1, code);
    assert.match(f.err(), sentence, code);
  }
});

test('a 409 just after the last job ended is the lock being let go a tick late, and is tried again', async () => {
  const f = fakeContext({
    routes: {
      'GET /v1/backup': [
        { status: 200, body: backupRecord('succeeded') }, // nothing runs: try again
        { status: 200, body: backupRecord('succeeded', { id: requestId }) },
      ],
      'GET /v1/status': [statusAnswer(updateJob('succeeded'))],
      'POST /v1/backup': [{ status: 409, body: { error: 'update_in_progress' } }, { status: 202, body: { id: requestId, phase: 'quiescing' } }],
    },
  });
  assert.equal(await run(f, ['backup', '--yes']), 0);
  const sent = posts(f, '/v1/backup');
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0]!.body, sent[1]!.body, 'the same request id, so a retry never starts two backups');
});

test('a 409 while an update runs is reported as busy, without retrying', async () => {
  const f = fakeContext({
    routes: {
      'GET /v1/backup': [{ status: 404, body: { error: 'not_found' } }],
      'GET /v1/status': [statusAnswer(updateJob('migrating'))],
      'POST /v1/backup': [{ status: 409, body: { error: 'update_in_progress' } }],
    },
  });
  assert.equal(await run(f, ['backup', '--yes']), 1);
  assert.equal(posts(f, '/v1/backup').length, 1);
  assert.match(f.err(), /An update or a backup is running\. Wait for it to finish/);
});

test('a backup whose record stops with no job running is reported as stuck, with the way out', async () => {
  const f = fakeContext({
    routes: {
      'GET /v1/backup': [{ status: 200, body: backupRecord('restarting') }],
      'GET /v1/status': [statusAnswer(updateJob('succeeded'))],
      'POST /v1/backup': [{ status: 202, body: { id: requestId, phase: 'quiescing' } }],
      'GET /v1/busy': [{ status: 200, body: { busy: false } }],
    },
  });
  assert.equal(await run(f, ['backup', '--yes']), 1);
  assert.match(f.err(), /stuck.*free some space.*sudo systemctl restart tomecms-updater/is);
  assert.equal(posts(f, '/v1/apply').length, 0, 'nothing is sent that could start a job');
});

test('a backup refused for manual recovery says so', async () => {
  const f = fakeContext({
    routes: {
      'GET /v1/backup': [{ status: 404, body: { error: 'not_found' } }],
      'POST /v1/backup': [{ status: 409, body: { error: 'manual_recovery_required' } }],
    },
  });
  assert.equal(await run(f, ['backup', '--yes']), 1);
  assert.match(f.err(), /manual recovery/);
});

// --- update -------------------------------------------------------------------------------------

/** The release check: the newest is `latest`; a named version is that one. Both carry `compatibility`. */
const release = (latest: string, compatibility: Record<string, unknown> = {}) => async (asked: string | null) => {
  const version = asked ?? latest;
  return {
    manifest: {
      version, releaseNotesUrl: `https://github.com/Dhanabhon/tome-cms/releases/tag/v${version}`,
      compatibility: {
        minimumDirectUpgradeFrom: '1.0.0', minimumUpdaterVersion: '1.0.0', targetMigration: '017_x', rollbackSafeFrom: '1.0.0',
        composeContract: 1, environmentContract: 1, updaterProtocol: 1, ...compatibility,
      },
    },
  };
};

test('update says so when TomeCMS is up to date, and changes nothing', async () => {
  const f = fakeContext({ routes: { 'GET /v1/status': [statusAnswer(null, '1.11.0')] }, overrides: { release: release('1.11.0') } });
  assert.equal(await run(f, ['update']), 0);
  assert.match(f.out(), /TomeCMS 1\.11\.0 is up to date\./);
  assert.equal(f.prompts.length, 0);
  assert.equal(posts(f, '/v1/apply').length, 0);
});

test('update shows the newest release and asks before installing it', async () => {
  const f = fakeContext({
    routes: { 'GET /v1/status': [statusAnswer(updateJob('succeeded', { targetVersion: '1.10.1' }))] },
    overrides: { release: release('1.11.0'), confirm: async (question) => { f.prompts.push(question); return false; } },
  });
  assert.equal(await run(f, ['update']), 1);
  assert.match(f.out(), /^Installed: 1\.10\.1$/m);
  assert.match(f.out(), /^Newest: 1\.11\.0 \(https:\/\/github\.com\/Dhanabhon\/tome-cms\/releases\/tag\/v1\.11\.0\)$/m);
  assert.deepEqual(f.prompts, ['Install 1.11.0? The updater checks the release, backs up the database (or everything, when the release has a migration) and puts the site in maintenance for a few minutes. [y/N] ']);
  assert.equal(posts(f, '/v1/apply').length, 0);
});

const updatePhases = ['preflight', 'verifying', 'downloading', 'quiescing', 'backing_up', 'migrating', 'restarting', 'health_check'];

test('update installs with a fresh request id and follows the job to success, one line per step', async () => {
  const f = fakeContext({
    routes: {
      'GET /v1/status': [
        statusAnswer(updateJob('succeeded', { id: '33333333-3333-4333-8333-333333333333', targetVersion: '1.10.1' })),
        ...updatePhases.map((phase) => statusAnswer(updateJob(phase))),
        statusAnswer(updateJob('succeeded'), '1.11.0'),
      ],
      'POST /v1/apply': [{ status: 202, body: updateJob('preflight') }],
    },
    overrides: { release: release('1.11.0') },
  });
  assert.equal(await run(f, ['update', '--yes']), 0);
  assert.deepEqual(posts(f, '/v1/apply')[0]!.body, { version: '1.11.0', requestId });
  assert.deepEqual(f.printed.slice(2), [
    '[1/8] Check prerequisites', '[2/8] Verify the official update', '[3/8] Download update', '[4/8] Prepare maintenance',
    '[5/8] Create recovery backup', '[6/8] Apply database migrations', '[7/8] Restart TomeCMS', '[8/8] Check application health',
    'TomeCMS 1.11.0 is installed.',
  ]);
});

test('an update that rolls back says the previous version runs again, and why', async () => {
  const f = fakeContext({
    routes: {
      'GET /v1/status': [
        statusAnswer(null),
        statusAnswer(updateJob('migrating')), statusAnswer(updateJob('rolling_back', { errorCode: 'migration_failed' })),
        statusAnswer(updateJob('rolled_back', { errorCode: 'migration_failed' })),
      ],
      'POST /v1/apply': [{ status: 202, body: updateJob('preflight') }],
    },
    overrides: { release: release('1.11.0') },
  });
  assert.equal(await run(f, ['update', '1.11.0', '--yes']), 1);
  assert.match(f.out(), /Restoring the previous version/);
  assert.match(f.err(), /did not complete\. TomeCMS 1\.10\.1 is running again\./);
  assert.match(f.err(), /migration failed/i);
});

test('an update stopped by a full disk names tome prune', async () => {
  const f = fakeContext({
    routes: {
      'GET /v1/status': [statusAnswer(null), statusAnswer(updateJob('rolled_back', { errorCode: 'insufficient_disk_space', completedSteps: 0 }))],
      'POST /v1/apply': [{ status: 202, body: updateJob('preflight') }],
    },
    overrides: { release: release('1.11.0') },
  });
  assert.equal(await run(f, ['update', '1.11.0', '--yes']), 1);
  assert.match(f.err(), /Not enough free disk space.*sudo tome prune/s);
});

test('an update that needs manual recovery says so', async () => {
  const f = fakeContext({
    routes: {
      'GET /v1/status': [statusAnswer(null), statusAnswer(updateJob('failed_manual_recovery', { errorCode: 'manual_recovery_required' }))],
      'POST /v1/apply': [{ status: 202, body: updateJob('preflight') }],
    },
    overrides: { release: release('1.11.0') },
  });
  assert.equal(await run(f, ['update', '1.11.0', '--yes']), 1);
  assert.match(f.err(), /manual recovery/);
});

test('update with a version uses it, and never installs an older one', async () => {
  const f = fakeContext({ routes: { 'GET /v1/status': [statusAnswer(null, '1.10.1')] } });
  assert.equal(await run(f, ['update', '1.9.0', '--yes']), 1);
  assert.match(f.err(), /1\.9\.0 is older than the installed 1\.10\.1/);
  assert.equal(posts(f, '/v1/apply').length, 0);
  const g = fakeContext({ routes: { 'GET /v1/status': [statusAnswer(null, '1.10.1')], 'POST /v1/apply': [statusAnswer(null, '1.10.1')] } });
  assert.equal(await run(g, ['update', '1.10.1']), 0);
  assert.match(g.out(), /TomeCMS 1\.10\.1 is up to date\./);
});

test('update refuses a release that needs a newer updater, and says how to get one', async () => {
  const f = fakeContext({ routes: { 'GET /v1/status': [statusAnswer(null)] }, overrides: { release: release('1.12.0', { minimumUpdaterVersion: '1.6.0' }) } });
  assert.equal(await run(f, ['update', '--yes']), 1);
  assert.match(f.err(), /needs updater 1\.6\.0.*sudo npm run updater:upgrade/s);
  assert.equal(posts(f, '/v1/apply').length, 0);
});

test('update without GitHub says to check the network', async () => {
  const f = fakeContext({ routes: { 'GET /v1/status': [statusAnswer(null)] }, overrides: { release: async () => { throw new ReleaseUnreachableError('TimeoutError'); } } });
  assert.equal(await run(f, ['update']), 1);
  assert.match(f.err(), /Could not reach GitHub.*network/s);
});

test('update refused because an update is running reports busy', async () => {
  const f = fakeContext({
    routes: {
      'GET /v1/status': [statusAnswer(null), statusAnswer(updateJob('downloading'))],
      'GET /v1/backup': [{ status: 404, body: { error: 'not_found' } }],
      'POST /v1/apply': [{ status: 409, body: { error: 'update_in_progress' } }],
    },
    overrides: { release: release('1.11.0') },
  });
  assert.equal(await run(f, ['update', '1.11.0', '--yes']), 1);
  assert.match(f.err(), /An update or a backup is running/);
});

test('update refuses a release whose contracts this server does not have, newest or named', async () => {
  for (const contract of ['updaterProtocol', 'composeContract', 'environmentContract']) {
    const newest = fakeContext({ routes: { 'GET /v1/status': [statusAnswer(null)] }, overrides: { release: release('1.12.0', { [contract]: 2 }) } });
    assert.equal(await run(newest, ['update', '--yes']), 1, contract);
    assert.match(newest.err(), /needs a manual upgrade of this server.*release notes/s, contract);
    const named = fakeContext({ routes: { 'GET /v1/status': [statusAnswer(null)] }, overrides: { release: release('1.12.0', { [contract]: 2 }) } });
    assert.equal(await run(named, ['update', '1.11.0', '--yes']), 1, contract);
    assert.match(named.err(), /needs a manual upgrade of this server/, contract);
    assert.equal(posts(named, '/v1/apply').length, 0);
  }
});

test('a named version is checked the same way, and one never released is said plainly', async () => {
  const asked: Array<string | null> = [];
  const f = fakeContext({ routes: { 'GET /v1/status': [statusAnswer(null)] }, overrides: { release: async (version) => { asked.push(version); return release('1.12.0', { minimumUpdaterVersion: '1.6.0' })(version); } } });
  assert.equal(await run(f, ['update', '1.11.0', '--yes']), 1);
  assert.deepEqual(asked, ['1.11.0']);
  assert.match(f.err(), /needs updater 1\.6\.0/);
  const missing = fakeContext({ routes: { 'GET /v1/status': [statusAnswer(null)] }, overrides: { release: async () => { throw new NoOfficialReleaseError(); } } });
  assert.equal(await run(missing, ['update', '1.11.0', '--yes']), 1);
  assert.match(missing.err(), /There is no TomeCMS release 1\.11\.0\./);
  const none = fakeContext({ routes: { 'GET /v1/status': [statusAnswer(null)] }, overrides: { release: async () => { throw new NoOfficialReleaseError(); } } });
  assert.equal(await run(none, ['update']), 0);
  assert.match(none.out(), /No TomeCMS release has been published yet/);
});

test('only an unreachable GitHub is a network problem; a release that fails its checks is not', async () => {
  const f = fakeContext({ routes: { 'GET /v1/status': [statusAnswer(null)] }, overrides: { release: async () => { throw new Error('Official release asset digest mismatch'); } } });
  assert.equal(await run(f, ['update']), 1);
  assert.match(f.err(), /could not be verified/);
  assert.doesNotMatch(f.err(), /network/);
});

test('an update that could not fetch the release on a full disk names tome prune, as the disk is the likely cause', async () => {
  const routes = () => ({
    'GET /v1/status': [statusAnswer(null), statusAnswer(updateJob('rolled_back', { errorCode: 'release_unavailable', completedSteps: 1 }))],
    'POST /v1/apply': [{ status: 202, body: updateJob('preflight') }],
  });
  const low = fakeContext({ routes: routes(), overrides: { release: release('1.11.0'), statfs: async () => ({ bsize: 4096, bavail: 1024 }) } });
  assert.equal(await run(low, ['update', '1.11.0', '--yes']), 1);
  assert.match(low.err(), /could not be fetched.*Not enough free disk space.*sudo tome prune/s);
  const roomy = fakeContext({ routes: routes(), overrides: { release: release('1.11.0') } });
  assert.equal(await run(roomy, ['update', '1.11.0', '--yes']), 1);
  assert.doesNotMatch(roomy.err(), /tome prune/);
});

// --- prune --------------------------------------------------------------------------------------

const candidates = [
  { id: `sha256:${'b'.repeat(64)}`, size: 1_200_000_000 },
  { id: `sha256:${'c'.repeat(64)}`, size: 753_000_000 },
  { id: `sha256:${'d'.repeat(64)}`, size: null },
];

test('prune is a dry run by default: what would go, with sizes and the total', async () => {
  const f = fakeContext({ routes: { 'POST /v1/prune': [{ status: 200, body: { candidates, removed: [] } }] } });
  assert.equal(await run(f, ['prune']), 0);
  assert.deepEqual(posts(f, '/v1/prune')[0]!.body, { dryRun: true });
  assert.deepEqual(f.printed, [
    'These old application images can go:',
    `  sha256:${'b'.repeat(12)}  1.1 GiB`,
    `  sha256:${'c'.repeat(12)}  718 MiB`,
    `  sha256:${'d'.repeat(12)}  size unknown`,
    'Total: about 1.8 GiB.',
    'Remove them with: sudo tome prune --yes',
  ]);
});

test('prune --yes removes them and prints what went and the space freed', async () => {
  const f = fakeContext({ routes: { 'POST /v1/prune': [{ status: 200, body: { candidates, removed: [candidates[0]!.id, candidates[1]!.id] } }] } });
  assert.equal(await run(f, ['prune', '--yes']), 0);
  assert.deepEqual(posts(f, '/v1/prune')[0]!.body, { dryRun: false });
  assert.deepEqual(f.printed, [
    `Removed sha256:${'b'.repeat(12)}  1.1 GiB`,
    `Removed sha256:${'c'.repeat(12)}  718 MiB`,
    'Freed about 1.8 GiB.',
    '1 image could not be removed; a stopped container may still use it.',
  ]);
});

test('prune with nothing to remove, an unreadable listing, and a busy updater', async () => {
  const none = fakeContext({ routes: { 'POST /v1/prune': [{ status: 200, body: { candidates: [], removed: [] } }] } });
  assert.equal(await run(none, ['prune']), 0);
  assert.deepEqual(none.printed, ['No old application images to remove.']);
  const unreadable = fakeContext({ routes: { 'POST /v1/prune': [{ status: 503, body: { error: 'image_listing_unreadable' } }] } });
  assert.equal(await run(unreadable, ['prune', '--yes']), 1);
  assert.match(unreadable.err(), /could not be read in full, so nothing was removed/);
  const busy = fakeContext({
    routes: {
      'POST /v1/prune': [{ status: 409, body: { error: 'update_in_progress' } }],
      'GET /v1/status': [statusAnswer(updateJob('backing_up'))],
      'GET /v1/backup': [{ status: 404, body: { error: 'not_found' } }],
    },
  });
  assert.equal(await run(busy, ['prune']), 1);
  assert.match(busy.err(), /An update or a backup is running/);
});
