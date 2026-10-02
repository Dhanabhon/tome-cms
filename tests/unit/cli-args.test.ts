import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCommand, UsageError } from '../../src/cli/args.js';
import { tome } from '../../src/cli/main.js';
import { UpdaterUnreachableError } from '../../src/cli/socket.js';
import { fakeContext } from '../helpers/cli-context.js';

test('each command takes its own options, with the documented defaults', () => {
  assert.deepEqual(parseCommand(['status']), { name: 'status', json: false });
  assert.deepEqual(parseCommand(['status', '--json']), { name: 'status', json: true });
  assert.deepEqual(parseCommand(['logs']), { name: 'logs', service: 'app', lines: 100, follow: false });
  assert.deepEqual(parseCommand(['logs', 'updater', '-n', '20', '-f']), { name: 'logs', service: 'updater', lines: 20, follow: true });
  assert.deepEqual(parseCommand(['logs', 'postgres', '--lines=5', '--follow']), { name: 'logs', service: 'postgres', lines: 5, follow: true });
  assert.deepEqual(parseCommand(['logs', 'seaweedfs']), { name: 'logs', service: 'seaweedfs', lines: 100, follow: false });
  assert.deepEqual(parseCommand(['backup']), { name: 'backup', full: false, yes: false });
  assert.deepEqual(parseCommand(['backup', '--full', '--yes']), { name: 'backup', full: true, yes: true });
  assert.deepEqual(parseCommand(['update']), { name: 'update', version: null, yes: false });
  assert.deepEqual(parseCommand(['update', '1.11.0', '-y']), { name: 'update', version: '1.11.0', yes: true });
  assert.deepEqual(parseCommand(['prune']), { name: 'prune', yes: false });
  assert.deepEqual(parseCommand(['prune', '--yes']), { name: 'prune', yes: true });
});

test('wrong usage is refused with that command\'s usage', () => {
  const cases: Array<[string[], RegExp]> = [
    [[], /Usage: sudo tome <command>/],
    [['frobnicate'], /Usage: sudo tome <command>/],
    [['status', '--full'], /Usage: sudo tome status/],
    [['status', 'extra'], /Usage: sudo tome status/],
    [['logs', 'nginx'], /Usage: sudo tome logs/],
    [['logs', 'app', 'postgres'], /Usage: sudo tome logs/],
    [['logs', '-n', '0'], /Usage: sudo tome logs/],
    [['logs', '-n', 'ten'], /Usage: sudo tome logs/],
    [['backup', 'now'], /Usage: sudo tome backup/],
    [['update', 'latest'], /Usage: sudo tome update/],
    [['update', '1.2'], /Usage: sudo tome update/],
    [['update', '1.0.0', '1.0.1'], /Usage: sudo tome update/],
    [['prune', '--dry-run'], /Usage: sudo tome prune/],
  ];
  for (const [argv, usage] of cases) {
    assert.throws(() => parseCommand(argv), (error: unknown) => error instanceof UsageError && usage.test(error.usage), argv.join(' '));
  }
});

test('--help explains tome and each command', () => {
  const overview = parseCommand(['--help']);
  assert.equal(overview.name, 'help');
  for (const name of ['status', 'logs', 'backup', 'update', 'prune']) assert.match(overview.name === 'help' ? overview.text : '', new RegExp(`\\b${name}\\b`));
  const expected: Record<string, RegExp[]> = {
    status: [/--json/], logs: [/-n, --lines/, /-f, --follow/, /updater/], backup: [/--full/, /--yes/, /maintenance/],
    update: [/\[version\]/, /--yes/], prune: [/--yes/, /dry run/i],
  };
  for (const [name, patterns] of Object.entries(expected)) {
    for (const flag of ['--help', '-h']) {
      const help = parseCommand([name, flag]);
      assert.equal(help.name, 'help');
      for (const pattern of patterns) assert.match(help.name === 'help' ? help.text : '', pattern, `${name} ${flag}`);
    }
  }
});

test('tome runs only as root, and says how to run it otherwise', async () => {
  let loaded = false;
  const f = fakeContext();
  const code = await tome(['status'], { uid: 1000, load: async () => { loaded = true; return f.context; }, print: f.context.print, warn: f.context.warn });
  assert.equal(code, 1);
  assert.match(f.err(), /root/);
  assert.match(f.err(), /sudo tome status/);
  assert.equal(loaded, false, 'nothing is read before the root check');
});

test('exit codes: 0 for help, 2 for wrong usage, 1 when the configuration cannot be read', async () => {
  const f = fakeContext();
  const io = { print: f.context.print, warn: f.context.warn };
  assert.equal(await tome(['--help'], { uid: 0, load: async () => f.context, ...io }), 0);
  assert.match(f.out(), /Usage: sudo tome <command>/);
  assert.equal(await tome(['logs', 'nginx'], { uid: 0, load: async () => f.context, ...io }), 2);
  assert.match(f.err(), /Usage: sudo tome logs/);
  assert.equal(await tome(['status'], { uid: 0, load: async () => { throw new Error('Invalid updater configuration'); }, ...io }), 1);
  assert.match(f.err(), /\/etc\/tome-cms\/updater\.json/);
});

test('an updater that does not answer is said plainly, and is a failure', async () => {
  const f = fakeContext({ routes: { 'POST /v1/prune': [new UpdaterUnreachableError()] } });
  const code = await tome(['prune'], { uid: 0, load: async () => f.context, print: f.context.print, warn: f.context.warn });
  assert.equal(code, 1);
  assert.match(f.err(), /updater did not answer/);
  assert.match(f.err(), /systemctl status tomecms-updater/);
});
