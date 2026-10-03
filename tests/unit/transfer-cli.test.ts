import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { closeQuietly, createOutDirectory, parseContentArgs } from '../../src/server/transfer/cli';

/** The CLI as a one-shot runs it, but with no environment at all: no database, no bucket, no secrets. */
function run(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/server/transfer/cli.ts', ...args], {
    encoding: 'utf8', env: {}, timeout: 30_000,
  });
}

test('the router turns a step and its option into one value', () => {
  assert.deepEqual(parseContentArgs(['restore-objects', '--backup', '/work/x']), { step: 'restore-objects', backup: '/work/x' });
  assert.deepEqual(parseContentArgs(['restore-database', '--dump', '/work/x/database.dump']), { step: 'restore-database', dump: '/work/x/database.dump' });
  assert.deepEqual(parseContentArgs(['after-restore']), { step: 'after-restore' });
  assert.deepEqual(parseContentArgs(['self-test']), { step: 'self-test' });
  assert.deepEqual(parseContentArgs(['export', '--out', '/work/export']), { step: 'export', out: '/work/export' });
  assert.throws(() => parseContentArgs(['export']), 'an export needs its directory');
  assert.throws(() => parseContentArgs(['restore-objects']), 'a restore step needs its path');
  assert.throws(() => parseContentArgs(['restore-objects', '--dump', '/work/x']), 'and only its own option');
  assert.throws(() => parseContentArgs(['after-restore', 'extra']), 'and nothing after it');
});

test('an unknown step is wrong usage: one JSON line, exit 2', () => {
  const result = run(['restore-everything']);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '{"ok":false,"code":"usage"}\n');
});

test('self-test answers without touching the environment, so the database client is never loaded', () => {
  const result = run(['self-test']);
  assert.equal(result.stdout, '{"ok":true}\n', result.stderr);
  assert.equal(result.status, 0);
});

test('a restore step refuses a path outside /work before it loads anything', () => {
  for (const args of [
    ['restore-objects', '--backup', '/tmp/backup'],
    ['restore-objects', '--backup', '/work/../etc'],
    ['restore-objects', '--backup', '/work'],
    ['restore-database', '--dump', '/workshop/database.dump'],
  ]) {
    const result = run(args);
    assert.equal(result.stdout, '{"ok":false,"code":"path_outside_work"}\n', args.join(' '));
    assert.equal(result.status, 1);
  }
});

test('an export refuses a directory anywhere but directly in /work, before it loads anything', () => {
  for (const out of ['/tmp/export', '/work', '/work/../export', '/work/a/b', 'work/export']) {
    const result = run(['export', '--out', out]);
    assert.equal(result.stdout, '{"ok":false,"code":"path_outside_work"}\n', out);
    assert.equal(result.status, 1);
  }
});

test('an export makes its own directory, and refuses one that is already there, even as a link', async (context) => {
  const work = await realpath(await mkdtemp(join(tmpdir(), 'tomecms-transfer-cli-')));
  context.after(() => rm(work, { force: true, recursive: true }));
  const code = (expected: string) => (error: unknown) => (error as { code?: unknown }).code === expected;

  const made = await createOutDirectory(join(work, 'export'), work);
  assert.equal(made, join(work, 'export'));
  assert.equal((await lstat(made)).mode & 0o777, 0o700);
  await assert.rejects(createOutDirectory(join(work, 'export'), work), code('out_exists'));
  await symlink(tmpdir(), join(work, 'link'));
  await assert.rejects(createOutDirectory(join(work, 'link'), work), code('out_exists'));
  await assert.rejects(createOutDirectory(join(work, 'export', 'deeper'), work), code('path_outside_work'));
});

test('an import takes its directory and exactly one of --plan and --apply', () => {
  assert.deepEqual(parseContentArgs(['import', '--dir', '/work/in', '--plan']), { step: 'import', dir: '/work/in', mode: 'plan' });
  assert.deepEqual(parseContentArgs(['import', '--apply', '--dir', '/work/in']), { step: 'import', dir: '/work/in', mode: 'apply' });
  assert.throws(() => parseContentArgs(['import', '--dir', '/work/in']), 'it says which');
  assert.throws(() => parseContentArgs(['import', '--dir', '/work/in', '--plan', '--apply']), 'and only one');
  assert.throws(() => parseContentArgs(['import', '--plan']), 'and names its directory');
});

test('an import refuses a directory outside /work before it loads anything', () => {
  for (const dir of ['/tmp/in', '/work', '/work/../etc', 'work/in']) {
    const result = run(['import', '--dir', dir, '--plan']);
    assert.equal(result.stdout, '{"ok":false,"code":"path_outside_work"}\n', dir);
    assert.equal(result.status, 1);
  }
});

test('a script loaded from node -e, with a path after it that does not exist, does not take itself for the entry', () => {
  for (const module of ['./src/server/transfer/cli.ts', './scripts/updater-upgrade.ts', './scripts/updater-clear-failed-job.ts']) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', '-e', `await import(${JSON.stringify(module)})`, '/no/such/entry'], {
      encoding: 'utf8', timeout: 30_000,
    });
    assert.equal(result.status, 0, `${module}: ${result.stderr}`);
    assert.equal(result.stdout, '', module);
  }
});

test('a database that will not close after a step has done its work is logged, and the step still answers ok', async (t) => {
  const logged = t.mock.method(console, 'error', () => undefined);
  await closeQuietly(async () => { throw new Error('Connection terminated'); });
  assert.deepEqual(logged.mock.calls.map((call) => call.arguments), [['Error: the database did not close: Connection terminated']]);
  await closeQuietly(async () => undefined);
  assert.equal(logged.mock.callCount(), 1);
});
