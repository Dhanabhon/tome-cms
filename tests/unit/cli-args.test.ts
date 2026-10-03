import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { isBuildCommand, parseBuildCommand, parseCommand, UsageError } from '../../src/cli/args.js';
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
  assert.deepEqual(parseCommand(['restore', '/var/backups/tome-cms/x']), { name: 'restore', directory: '/var/backups/tome-cms/x', yes: false });
  assert.deepEqual(parseCommand(['restore', 'x', '--yes']), { name: 'restore', directory: 'x', yes: true });
  assert.deepEqual(parseCommand(['export']), { name: 'export' });
  assert.deepEqual(parseCommand(['import', 'a.tar.gz']), { name: 'import', path: 'a.tar.gz', dryRun: false, yes: false });
  assert.deepEqual(parseCommand(['import', 'a.tar.gz', '--dry-run', '-y']), { name: 'import', path: 'a.tar.gz', dryRun: true, yes: true });
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
    [['restore'], /Usage: sudo tome restore/],
    [['restore', 'a', 'b'], /Usage: sudo tome restore/],
    [['restore', 'a', '--full'], /Usage: sudo tome restore/],
    [['export', 'somewhere'], /Usage: sudo tome export/],
    [['export', '--yes'], /Usage: sudo tome export/],
    [['import'], /Usage: sudo tome import/],
    [['import', 'a', 'b'], /Usage: sudo tome import/],
    [['import', 'a', '--full'], /Usage: sudo tome import/],
  ];
  for (const [argv, usage] of cases) {
    assert.throws(() => parseCommand(argv), (error: unknown) => error instanceof UsageError && usage.test(error.usage), argv.join(' '));
  }
});

test('--help explains tome and each command', () => {
  const overview = parseCommand(['--help']);
  assert.equal(overview.name, 'help');
  for (const name of ['status', 'logs', 'backup', 'update', 'prune', 'restore', 'export', 'import']) assert.match(overview.name === 'help' ? overview.text : '', new RegExp(`\\b${name}\\b`));
  const expected: Record<string, RegExp[]> = {
    status: [/--json/], logs: [/-n, --lines/, /-f, --follow/, /updater/], backup: [/--full/, /--yes/, /maintenance/],
    update: [/\[version\]/, /--yes/], prune: [/--yes/, /dry run/i],
    restore: [/<backup>/, /--yes/, /safety backup/, /replaced/],
    export: [/markdown-<time>\.tar\.gz/, /stays up/], import: [/<archive>/, /--dry-run/, /--yes/, /overwritten/],
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

test('the builder commands parse, with their options and defaults', () => {
  assert.deepEqual(parseBuildCommand(['theme', 'new', 'ledger']), { name: 'theme new', id: 'ledger', from: 'plain', dryRun: false });
  assert.deepEqual(parseBuildCommand(['theme', 'new', 'ledger', '--from', 'almanac', '--dry-run']), { name: 'theme new', id: 'ledger', from: 'almanac', dryRun: true });
  assert.deepEqual(parseBuildCommand(['plugin', 'new', 'nimbus', '--hook', 'publicPage']), { name: 'plugin new', id: 'nimbus', hook: 'publicPage', client: false, dryRun: false });
  assert.deepEqual(parseBuildCommand(['plugin', 'new', 'nimbus', '--hook=signIn', '--client', '--dry-run']), { name: 'plugin new', id: 'nimbus', hook: 'signIn', client: true, dryRun: true });
  assert.deepEqual(parseBuildCommand(['plugin', 'new', 'nimbus', '--hook', 'editorSuggestions']), { name: 'plugin new', id: 'nimbus', hook: 'editorSuggestions', client: false, dryRun: false });
  assert.deepEqual(parseBuildCommand(['check']), { name: 'check' });
  for (const name of ['theme', 'plugin', 'check']) assert.equal(isBuildCommand(name), true, name);
  for (const name of ['status', 'logs', 'backup', 'update', 'prune', '--help', undefined]) assert.equal(isBuildCommand(name), false, String(name));
});

test('wrong builder usage is refused with that command\'s usage', () => {
  const cases: Array<[string[], RegExp]> = [
    [['theme'], /Usage: npm run tome -- theme new/],
    [['theme', 'make', 'ledger'], /Usage: npm run tome -- theme new/],
    [['theme', 'new'], /Usage: npm run tome -- theme new/],
    [['theme', 'new', 'a', 'b'], /Usage: npm run tome -- theme new/],
    [['theme', 'new', 'ledger', '--from', 'ledger2'], /Usage: npm run tome -- theme new/],
    [['theme', 'new', 'ledger', '--client'], /Usage: npm run tome -- theme new/],
    [['plugin', 'new', 'nimbus'], /Usage: npm run tome -- plugin new/],
    [['plugin', 'new', 'nimbus', '--hook', 'mcp'], /Usage: npm run tome -- plugin new/],
    [['plugin', 'new', '--hook', 'signIn'], /Usage: npm run tome -- plugin new/],
    [['check', 'paper'], /Usage: npm run tome -- check/],
    [['check', '--dry-run'], /Usage: npm run tome -- check/],
  ];
  for (const [argv, usage] of cases) {
    assert.throws(() => parseBuildCommand(argv), (error: unknown) => error instanceof UsageError && usage.test(error.usage), argv.join(' '));
  }
});

test('--help explains each builder command, and the overview names them', () => {
  const overview = parseCommand(['--help']);
  for (const name of ['theme new', 'plugin new', 'check']) assert.match(overview.name === 'help' ? overview.text : '', new RegExp(`\\b${name}\\b`));
  const expected: Array<[string[], RegExp[]]> = [
    [['theme'], [/--from plain\|paper\|almanac/, /--dry-run/, /checkout/]],
    [['theme', 'new'], [/--from plain\|paper\|almanac/, /--dry-run/]],
    [['plugin', 'new'], [/--hook publicPage\|signIn\|editorSuggestions/, /--client/, /--dry-run/]],
    [['check'], [/path:line/]],
  ];
  for (const [argv, patterns] of expected) {
    for (const flag of ['--help', '-h']) {
      const help = parseBuildCommand([...argv, flag]);
      assert.equal(help.name, 'help');
      for (const pattern of patterns) assert.match(help.name === 'help' ? help.text : '', pattern, `${argv.join(' ')} ${flag}`);
    }
  }
});

test('the builder commands need no root, and refuse outside a checkout before reading anything', async (t) => {
  const outside = await mkdtemp(join(tmpdir(), 'tome-outside-'));
  // A checkout with nothing in it: whatever a builder command does there, it cannot touch this repository.
  const checkout = await mkdtemp(join(tmpdir(), 'tome-checkout-'));
  t.after(() => Promise.all([outside, checkout].map((path) => rm(path, { recursive: true, force: true }))));
  await writeFile(join(checkout, 'package.json'), JSON.stringify({ name: 'tome-cms' }));
  await mkdir(join(checkout, 'src', 'themes'), { recursive: true });
  await writeFile(join(checkout, 'src', 'themes', 'manifests.ts'), '');
  for (const argv of [['theme', 'new', 'ledger'], ['plugin', 'new', 'nimbus', '--hook', 'signIn'], ['check']]) {
    let loaded = false;
    const f = fakeContext();
    const io = { uid: 1000, load: async () => { loaded = true; return f.context; }, print: f.context.print, warn: f.context.warn };
    assert.equal(await tome(argv, { ...io, cwd: outside }), 1, argv.join(' '));
    assert.equal(f.err(), 'Run this in a TomeCMS source checkout.');
    assert.equal(await tome(argv, { ...io, cwd: checkout }), 1, argv.join(' '));
    assert.doesNotMatch(f.err(), /root|sudo/);
    assert.equal(loaded, false, 'the updater\'s configuration is never read');
    assert.equal(await tome([...argv, '--help'], { ...io, cwd: outside }), 0);
    assert.equal(await tome([argv[0], '--wrong'], { ...io, cwd: outside }), 2);
  }
});

test('inside a checkout, only that checkout\'s own src/cli/main.ts runs the builder commands: the server\'s compiled tome refuses', async (t) => {
  const checkout = await mkdtemp(join(tmpdir(), 'tome-checkout-'));
  t.after(() => rm(checkout, { recursive: true, force: true }));
  await writeFile(join(checkout, 'package.json'), JSON.stringify({ name: 'tome-cms' }));
  await mkdir(join(checkout, 'src', 'themes'), { recursive: true });
  await writeFile(join(checkout, 'src', 'themes', 'manifests.ts'), '');
  const listing = async () => (await readdir(checkout, { recursive: true })).sort();
  const before = await listing();
  const own = join(await realpath(checkout), 'src', 'cli', 'main.ts');
  // The installed tome, a build of this checkout, another checkout's source, and no word at all.
  for (const self of ['/opt/tome-cms/updater/cli/main.js', join(await realpath(checkout), 'dist-updater', 'cli', 'main.js'), '/elsewhere/tome-cms/src/cli/main.ts', undefined]) {
    for (const argv of [['theme', 'new', 'ledger'], ['plugin', 'new', 'nimbus', '--hook', 'signIn'], ['check']]) {
      const f = fakeContext();
      const io = { uid: 0, load: async () => f.context, print: f.context.print, warn: f.context.warn, cwd: checkout, self };
      assert.equal(await tome(argv, io), 1, `${self} ${argv.join(' ')}`);
      assert.equal(f.err(), 'Run this in a TomeCMS source checkout.', `${self} ${argv.join(' ')}`);
    }
  }
  assert.deepEqual(await listing(), before, 'nothing was written');
  // The checkout's own source gets past that refusal (this bare checkout then stops on its empty lists).
  const f = fakeContext();
  await tome(['check'], { uid: 1000, load: async () => f.context, print: f.context.print, warn: f.context.warn, cwd: checkout, self: own });
  assert.notEqual(f.err(), 'Run this in a TomeCMS source checkout.');
});

test('the server commands still demand root, and the overview needs none', async () => {
  const f = fakeContext();
  const io = { uid: 1000, load: async () => f.context, print: f.context.print, warn: f.context.warn };
  for (const name of ['status', 'logs', 'backup', 'update', 'prune', 'restore', 'export', 'import']) {
    assert.equal(await tome([name], io), 1, name);
    assert.match(f.err(), new RegExp(`sudo tome ${name}`));
  }
  assert.equal(await tome(['--help'], io), 0);
  assert.match(f.out(), /Usage: sudo tome <command>/);
});
