import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { parseContentArgs } from '../../src/server/transfer/cli';

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
