import assert from 'node:assert/strict';
import { test } from 'node:test';

import { upgradeRefusal } from '../../scripts/updater-upgrade';

const ready = { root: true, tag: 'v1.3.0', packageVersion: '1.3.0', clean: true, jobPhase: 'succeeded' as string | null, running: '1.0.0' };

test('an upgrade runs only as root, from a clean checkout of the exact release tag', () => {
  assert.equal(upgradeRefusal(ready), null);
  assert.match(upgradeRefusal({ ...ready, root: false }) ?? '', /root/);
  assert.match(upgradeRefusal({ ...ready, tag: '' }) ?? '', /release tag/);
  assert.match(upgradeRefusal({ ...ready, tag: 'v1.2.1' }) ?? '', /release tag/);
  assert.match(upgradeRefusal({ ...ready, clean: false }) ?? '', /clean/);
});

test('an upgrade never replaces the updater in the middle of an update', () => {
  for (const phase of ['preflight', 'downloading', 'backing_up', 'migrating', 'rolling_back']) {
    assert.match(upgradeRefusal({ ...ready, jobPhase: phase }) ?? '', /in progress/, phase);
  }
  for (const phase of [null, 'succeeded', 'rolled_back', 'failed_manual_recovery']) {
    assert.equal(upgradeRefusal({ ...ready, jobPhase: phase }), null, String(phase));
  }
});

test('an upgrade does not go backwards', () => {
  assert.match(upgradeRefusal({ ...ready, running: '1.4.0' }) ?? '', /newer/);
  assert.equal(upgradeRefusal({ ...ready, running: '1.3.0' }), null, 'the same version again repairs a damaged install');
});

import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { swapUpdater, type SwapOperations } from '../../scripts/updater-upgrade';

async function server(options: { jobAfterStop?: string | null; answers?: boolean; failing?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'tomecms-swap-'));
  const paths = {
    install: join(root, 'opt', 'updater'), service: join(root, 'etc', 'tomecms-updater.service'), compose: join(root, 'opt', 'compose.managed.yaml'),
    built: join(root, 'built'), releaseService: join(root, 'release', 'unit'), releaseCompose: join(root, 'release', 'compose'),
  };
  // The build's output is `<built>/updater/`, laid out as the install is: `updater/main.js` inside it.
  for (const dir of [join(paths.install, 'updater'), join(paths.built, 'updater', 'updater'), join(root, 'etc'), join(root, 'release')]) await mkdir(dir, { recursive: true });
  await writeFile(join(paths.install, 'updater', 'main.js'), 'old');
  await writeFile(join(paths.built, 'updater', 'updater', 'main.js'), 'new');
  await writeFile(paths.service, 'old unit');
  await writeFile(paths.compose, 'old compose');
  await writeFile(paths.releaseService, 'new unit');
  await writeFile(paths.releaseCompose, 'new compose');
  const calls: string[] = [];
  let running = true;
  const operations: SwapOperations = {
    run: (command, args) => {
      calls.push([command, ...args].join(' '));
      if (options.failing && calls.at(-1) === options.failing) throw new Error(`${options.failing} failed.`);
      if (command === 'systemctl' && args[0] === 'stop') running = false;
      if (command === 'systemctl' && args[0] === 'start') running = true;
    },
    jobPhase: async () => options.jobAfterStop ?? null,
    answers: async () => options.answers ?? true,
    log: () => undefined,
  };
  return { root, paths, calls, operations, running: () => running, read: (path: string) => readFile(path, 'utf8') };
}

test('a swap replaces the updater, its unit and the compose file, keeping the old ones beside them', async () => {
  const s = await server();
  const result = await swapUpdater(s.paths, 'STAMP', s.operations);
  assert.equal(await s.read(join(s.paths.install, 'updater', 'main.js')), 'new');
  assert.equal(await s.read(s.paths.service), 'new unit');
  assert.equal(await s.read(s.paths.compose), 'new compose');
  assert.equal(await s.read(join(`${s.paths.install}.previous-STAMP`, 'updater', 'main.js')), 'old');
  assert.equal(await s.read(`${s.paths.compose}.previous-STAMP`), 'old compose');
  assert.equal(result.composeChanged, true, 'the operator is told their compose file was not the release one');
  assert.ok(s.running());
});

test('an update that began before the updater stopped is left to finish, and nothing is replaced', async () => {
  // The job was checked before a build that takes a minute; only a stopped updater is sure not to start one.
  const s = await server({ jobAfterStop: 'backing_up' });
  await assert.rejects(swapUpdater(s.paths, 'STAMP', s.operations), /in progress/);
  assert.equal(await s.read(join(s.paths.install, 'updater', 'main.js')), 'old');
  assert.equal((await readdir(join(s.root, 'opt'))).some((name) => name.includes('previous')), false);
  assert.ok(s.running(), 'and the updater is running again');
});

test('a new updater that does not answer is replaced by the old one, unit and compose included', async () => {
  const s = await server({ answers: false });
  await assert.rejects(swapUpdater(s.paths, 'STAMP', s.operations), /did not answer/);
  assert.equal(await s.read(join(s.paths.install, 'updater', 'main.js')), 'old');
  assert.equal(await s.read(s.paths.service), 'old unit');
  assert.equal(await s.read(s.paths.compose), 'old compose');
  assert.ok(s.running());
});

test('a step of the restore that fails does not stop the rest, and the updater is always started last', async () => {
  const s = await server({ answers: false, failing: 'systemctl daemon-reload' });
  await assert.rejects(swapUpdater(s.paths, 'STAMP', s.operations));
  assert.equal(await s.read(join(s.paths.install, 'updater', 'main.js')), 'old', 'the old tree is back');
  assert.equal(s.calls.at(-1), 'systemctl start tomecms-updater');
  assert.ok(s.running());
});
