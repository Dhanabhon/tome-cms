import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { makeEnvironment, renderEnvironment } from '../../scripts/bootstrap-core.mjs';
import { tome } from '../../src/cli/main.js';
import { fakeContext } from '../helpers/cli-context.js';

const secret = 'a-very-secret-auth-value-123';
const databasePassword = 'db-password-456789';

async function environmentFile(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'tome-cli-logs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'tome-cms.env');
  await writeFile(path, [
    `BETTER_AUTH_SECRET='${secret}'`,
    `DATABASE_URL='postgres://tomecms:${databasePassword}@postgres:5432/tomecms'`,
    "TOME_CMS_PUBLIC_URL='https://cms.example.com'",
    '',
  ].join('\n'));
  return path;
}

function logging(path: string, output: Array<[string, 'stdout' | 'stderr']>, exitCode = 0) {
  const commands: string[][] = [];
  const f = fakeContext({
    config: { environmentFile: path },
    overrides: {
      streamCommand: async (executable, args, onLine) => {
        commands.push([executable, ...args]);
        for (const [line, stream] of output) onLine(line, stream);
        return exitCode;
      },
    },
  });
  return { ...f, commands };
}
const run = (f: ReturnType<typeof logging>, argv: string[]) => tome(argv, { uid: 0, load: async () => f.context, print: f.context.print, warn: f.context.warn });

test('logs shows the app by default, from the managed compose project, with secrets hidden', async (t) => {
  const path = await environmentFile(t);
  const f = logging(path, [
    ['app-1  | started', 'stdout'],
    [`app-1  | auth secret is ${secret}`, 'stdout'],
    [`app-1  | cannot reach postgres://tomecms:${databasePassword}@postgres:5432`, 'stderr'],
  ]);
  assert.equal(await run(f, ['logs']), 0);
  assert.deepEqual(f.commands, [['docker', 'compose', '-p', 'tomecms', '-f', '/opt/tome-cms/compose.managed.yaml',
    '--env-file', path, '--env-file', '/var/lib/tome-cms/updater/image.env', 'logs', '--tail', '100', 'app']]);
  assert.deepEqual(f.printed, ['app-1  | started', 'app-1  | auth secret is [redacted]']);
  assert.deepEqual(f.warned, ['app-1  | cannot reach postgres://tomecms:[redacted]@postgres:5432']);
});

test('logs of a service, a line count and follow', async (t) => {
  const path = await environmentFile(t);
  const f = logging(path, []);
  assert.equal(await run(f, ['logs', 'postgres', '-n', '20', '-f']), 0);
  assert.deepEqual(f.commands[0]!.slice(-5), ['logs', '--tail', '20', '--follow', 'postgres']);
});

test('logs of the updater come from its journal', async (t) => {
  const path = await environmentFile(t);
  const f = logging(path, [[`{"event":"x","stdout":"${secret}"}`, 'stdout']]);
  assert.equal(await run(f, ['logs', 'updater', '--lines', '5', '--follow']), 0);
  assert.deepEqual(f.commands, [['journalctl', '-u', 'tomecms-updater', '-n', '5', '--no-pager', '--follow']]);
  assert.deepEqual(f.printed, ['{"event":"x","stdout":"[redacted]"}']);
});

test('logs on a server the installer set up: lines show, and every secret the installer wrote is hidden', async (t) => {
  // The env exactly as the managed installer writes it, so this cannot drift from real servers.
  const values = makeEnvironment({ TOME_CMS_PUBLIC_URL: 'https://cms.example.com', S3_ENDPOINT: 'https://media.example.com' }, true, {}, true);
  const root = await mkdtemp(join(tmpdir(), 'tome-cli-logs-installed-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'tome-cms.env');
  await writeFile(path, renderEnvironment(values));
  const f = logging(path, [
    ['app-1  | Listening on http://0.0.0.0:4321', 'stdout'],
    [`app-1  | token ${values.TOME_CMS_INSTALL_TOKEN} secret ${values.S3_SECRET_ACCESS_KEY} key id ${values.S3_ACCESS_KEY_ID}`, 'stdout'],
  ]);
  assert.equal(await run(f, ['logs']), 0, f.err());
  assert.deepEqual(f.printed, ['app-1  | Listening on http://0.0.0.0:4321', 'app-1  | token [redacted] secret [redacted] key id tomecms']);
});

test('logs fail closed, and say why once: an env that cannot be read, is not in the managed format, or has a secret too short to hide', async (t) => {
  const missing = logging(join(tmpdir(), 'tome-cli-no-such-dir', 'tome-cms.env'), [['anything', 'stdout']]);
  assert.equal(await run(missing, ['logs']), 1);
  assert.equal(missing.commands.length, 0);
  assert.match(missing.err(), /could not be read/);

  const root = await mkdtemp(join(tmpdir(), 'tome-cli-logs-refused-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cases: Array<[string, string, RegExp]> = [
    ['unquoted', 'BETTER_AUTH_SECRET=a-very-secret-auth-value-123\n', /not in the managed format/],
    ['short', "BETTER_AUTH_SECRET='short'\n", /shorter than 8 bytes/],
    ['many', Array.from({ length: 65 }, (_, index) => `SECRET_${index}='secret-value-number-${index}'`).join('\n') + '\n', /more than 64 secrets/],
  ];
  for (const [name, text, reason] of cases) {
    const path = join(root, `${name}.env`);
    await writeFile(path, text);
    const f = logging(path, [['one', 'stdout'], ['two', 'stdout']]);
    assert.equal(await run(f, ['logs']), 1, name);
    assert.equal(f.commands.length, 0, `${name}: nothing is run`);
    assert.deepEqual(f.printed, [], name);
    assert.equal(f.warned.length, 1, `${name}: said once`);
    assert.match(f.warned[0]!, reason, name);
    assert.doesNotMatch(f.warned[0]!, /could not be read/, name);
  }

  const failing = logging(await environmentFile(t), [], 1);
  assert.equal(await run(failing, ['logs', 'seaweedfs']), 1);
});
