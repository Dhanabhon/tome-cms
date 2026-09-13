import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { parseOptions, renderEnvironment, writeEnvironment, makeEnvironment } from '../../scripts/bootstrap-core.mjs';

test('bootstrap options default to local, select production and reject unknown flags', () => {
  assert.deepEqual(parseOptions([]), { production: false, force: false });
  assert.equal(parseOptions(['--production', '--force']).production, true);
  assert.equal(parseOptions(['--production', '--force']).force, true);
  assert.throws(() => parseOptions(['--produciton']), /Unknown option/);
});

test('environment renders required values once with literal secrets and rejects injection', () => {
  const values = makeEnvironment({}, false);
  const rendered = renderEnvironment(values);
  assert.deepEqual({ ...parseEnv(rendered) }, values);
  for (const key of ['TOME_CMS_INSTALL_TOKEN', 'BETTER_AUTH_SECRET', 'TOME_CMS_CONTEXT_SECRET', 'TOME_CMS_RECOVERY_PEPPER', 'POSTGRES_PASSWORD', 'S3_SECRET_ACCESS_KEY']) {
    assert.match(values[key], /^[A-Za-z0-9_-]{43}$/);
    assert.equal(rendered.match(new RegExp(`^${key}=`, 'gm'))?.length, 1);
  }
  assert.throws(() => renderEnvironment({ ...values, BETTER_AUTH_SECRET: '' }), /BETTER_AUTH_SECRET/);
  assert.throws(() => renderEnvironment({ ...values, BAD: "one\nBAD=two" }), /BAD/);
  assert.throws(() => renderEnvironment({ ...values, 'BAD\nKEY': 'value' }), /key/);
  assert.equal(parseEnv(renderEnvironment({ ...values, CUSTOM: '$not_interpolated#value' })).CUSTOM, '$not_interpolated#value');
});

test('existing secrets survive reruns and production requires explicit HTTPS URLs', () => {
  const original = makeEnvironment({}, false);
  assert.deepEqual(makeEnvironment(original, false), original);
  assert.throws(() => makeEnvironment(original, true), /HTTPS/);
  const production = makeEnvironment({ ...original, TOME_CMS_PUBLIC_URL: 'https://cms.example.com', S3_ENDPOINT: 'https://s3.example.com', MEDIA_PUBLIC_URL: 'https://s3.example.com/tomecms-media/' }, true);
  assert.equal(production.NODE_ENV, 'production');
  assert.equal(production.BETTER_AUTH_SECRET, original.BETTER_AUTH_SECRET);
});

test('only managed production generation enables the updater and preserves secrets', () => {
  const input = { TOME_CMS_PUBLIC_URL: 'https://cms.example.com', S3_ENDPOINT: 'https://s3.example.com' };
  const original = makeEnvironment(input, false);
  assert.equal(original.TOME_CMS_UPDATE_MODE, 'check-only');
  assert.equal(makeEnvironment({ ...input, TOME_CMS_UPDATE_MODE: 'managed' }, true).TOME_CMS_UPDATE_MODE, 'check-only');
  const managed = makeEnvironment(input, true, original, true);
  assert.equal(managed.TOME_CMS_UPDATE_MODE, 'managed');
  assert.equal(managed.TOME_CMS_UPDATER_SOCKET, '/run/tome-cms/updater.sock');
  assert.equal(managed.BETTER_AUTH_SECRET, original.BETTER_AUTH_SECRET);
  assert.equal(makeEnvironment({}, false, managed).TOME_CMS_UPDATE_MODE, 'check-only');
  assert.throws(() => makeEnvironment({}, false, {}, true), /production/);
});

test('changed inputs refresh generated URLs while preserving explicit custom URLs', () => {
  const original = makeEnvironment({}, false);
  const changes = { POSTGRES_PORT: '55433', S3_PORT: '59002', APP_PORT: '44321', S3_BUCKET: 'other-media' };
  const changed = makeEnvironment(changes, false, original);
  assert.equal(new URL(changed.DATABASE_URL).port, '55433');
  assert.equal(changed.S3_ENDPOINT, 'http://127.0.0.1:59002');
  assert.equal(changed.TOME_CMS_PUBLIC_URL, 'http://localhost:44321');
  assert.equal(changed.MEDIA_PUBLIC_URL, 'http://127.0.0.1:59002/other-media/');
  assert.equal(changed.POSTGRES_PASSWORD, original.POSTGRES_PASSWORD);
  const custom = {
    DATABASE_URL: 'postgresql://custom:password@db.example.com:6432/custom',
    S3_ENDPOINT: 'https://s3.example.com', TOME_CMS_PUBLIC_URL: 'https://cms.example.com',
    MEDIA_PUBLIC_URL: 'https://cdn.example.com/media/',
  };
  const preserved = makeEnvironment(changes, false, { ...original, ...custom });
  for (const [key, value] of Object.entries(custom)) assert.equal(preserved[key], value);
  const explicit = makeEnvironment({ ...changes, S3_ENDPOINT: 'https://objects.example.com' }, false, original);
  assert.equal(explicit.S3_ENDPOINT, 'https://objects.example.com');
  assert.equal(explicit.MEDIA_PUBLIC_URL, 'https://objects.example.com/other-media/');
  assert.equal(makeEnvironment({ ...changes, DATABASE_URL: original.DATABASE_URL }, false, original).DATABASE_URL, original.DATABASE_URL);
  assert.deepEqual(makeEnvironment({}, false, changed), changed);
});

test('legacy AIStor settings migrate without carrying license requirements forward', () => {
  const migrated = makeEnvironment({}, false, {
    ...makeEnvironment({}, false),
    MINIO_PORT: '59002',
    MINIO_CONSOLE_PORT: '59003',
    MINIO_LICENSE_FILE: '/external/license',
    S3_ENDPOINT: 'http://127.0.0.1:59002',
    MEDIA_PUBLIC_URL: 'http://127.0.0.1:59002/tomecms-media/',
  });
  assert.equal(migrated.S3_PORT, '59002');
  assert.equal(migrated.S3_ENDPOINT, 'http://127.0.0.1:59002');
  for (const key of ['MINIO_PORT', 'MINIO_CONSOLE_PORT', 'MINIO_LICENSE_FILE']) assert.equal(migrated[key], undefined);
});

test('production rejects Docker service and loopback endpoints even with HTTPS', () => {
  const input = { TOME_CMS_PUBLIC_URL: 'https://cms.example.com', S3_ENDPOINT: 'https://s3.example.com' };
  for (const host of ['seaweedfs', 'postgres', 'app', 'localhost', 'example.localhost', '127.0.0.1', '127.2.3.4', '2130706433', '[::1]', '[::ffff:127.0.0.1]', '0.0.0.0', '[::]', 'host.docker.internal']) {
    assert.throws(() => makeEnvironment({ ...input, S3_ENDPOINT: `https://${host}:9000` }, true), /browser-reachable/);
  }
  assert.throws(() => makeEnvironment({ ...input, MEDIA_PUBLIC_URL: 'https://seaweedfs:8333/media/' }, true), /browser-reachable/);
  assert.equal(makeEnvironment(input, true).S3_ENDPOINT, input.S3_ENDPOINT);
});

test('public URL stays an exact origin for Passkeys and bucket CORS', () => {
  for (const suffix of ['/admin', '?preview=1', '#install']) {
    assert.throws(() => makeEnvironment({ TOME_CMS_PUBLIC_URL: `http://localhost:4321${suffix}` }, false), /origin without/);
  }
  assert.equal(makeEnvironment({ TOME_CMS_PUBLIC_URL: 'http://localhost:4321/' }, false).TOME_CMS_PUBLIC_URL, 'http://localhost:4321');
});

test('production public-host policy rejects local suffixes and non-public IP ranges in every public URL', () => {
  const input = {
    TOME_CMS_PUBLIC_URL: 'https://cms.example.com',
    S3_ENDPOINT: 'https://s3.example.com', MEDIA_PUBLIC_URL: 'https://cdn.example.com/media/',
  };
  const blocked = [
    'minio.local', 'MINIO.LOCAL.', 'minio.local..', 'minio.local%2e', 'cms.internal', 'cms.home.arpa', 'cms.localdomain', 'cms.lan',
    'cms.test', 'cms.invalid', 'cms.example', 'cms.onion', 'cms.alt',
    '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '100.64.0.1', '100.127.255.255', '169.254.169.254', '0.1.2.3',
    '192.0.0.1', '192.0.2.1', '192.88.99.1', '198.18.0.1', '198.19.255.255',
    '198.51.100.1', '203.0.113.1', '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255',
    '0x0a000001', '167772161', '[fc00::1]', '[fdff:ffff::1]', '[fe80::1]', '[febf::1]',
    '[fec0::1]', '[ff02::1]', '[::ffff:10.0.0.1]', '[64:ff9b::a00:1]', '[100::1]',
    '[2001:2::1]', '[2001:db8::1]', '[2002:a00:1::1]', '[3fff::1]',
  ];
  for (const key of ['TOME_CMS_PUBLIC_URL', 'S3_ENDPOINT', 'MEDIA_PUBLIC_URL']) {
    for (const host of blocked) {
      assert.throws(() => makeEnvironment({ ...input, [key]: `https://${host}:9000` }, true), /browser-reachable/, `${key}: ${host}`);
    }
    for (const host of ['cms.example.com', 'storage.local.example.com', '8.8.8.8', '100.63.255.254', '100.128.0.1', '172.15.255.254', '172.32.0.1', '198.17.255.254', '198.20.0.1', '[2001:4860:4860::8888]', '[2606:4700:4700::1111]']) {
      assert.equal(makeEnvironment({ ...input, [key]: `https://${host}` }, true)[key], `https://${host}`);
    }
  }
  assert.equal(makeEnvironment({ ...input, S3_ENDPOINT: 'http://10.0.0.1:9000' }, false).S3_ENDPOINT, 'http://10.0.0.1:9000');
});

test('production transitions keep migrations and the app on the bundled Compose database', () => {
  const input = { TOME_CMS_PUBLIC_URL: 'https://cms.example.com', S3_ENDPOINT: 'https://s3.example.com' };
  const local = makeEnvironment(input, false);
  const production = makeEnvironment({}, true, local);
  assert.equal(production.DATABASE_URL, local.DATABASE_URL);
  assert.equal(makeEnvironment({ DATABASE_URL: local.DATABASE_URL }, true, local).DATABASE_URL, local.DATABASE_URL);
  const changed = makeEnvironment({ POSTGRES_PORT: '55433', POSTGRES_PASSWORD: 'replacement-password' }, true, local);
  assert.equal(changed.DATABASE_URL, 'postgresql://tomecms:replacement-password@127.0.0.1:55433/tomecms');
  const custom = 'postgresql://custom:password@db.example.com:6432/custom';
  assert.equal(makeEnvironment({ DATABASE_URL: custom }, false, local).DATABASE_URL, custom);
  assert.throws(() => makeEnvironment({ DATABASE_URL: custom }, true, local), /bundled Compose database/);
  assert.throws(() => makeEnvironment({}, true, { ...local, DATABASE_URL: custom }), /bundled Compose database/);
  assert.throws(() => makeEnvironment({ POSTGRES_PORT: '55433', DATABASE_URL: local.DATABASE_URL }, true, local), /bundled Compose database/);
});

test('bootstrap waits for SeaweedFS, then migrates and starts the app', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'tomecms-startup-test-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const repository = join(directory, 'repo');
  await mkdir(join(repository, 'scripts'), { recursive: true });
  const script = join(repository, 'scripts/bootstrap-core.mjs');
  await copyFile(new URL('../../scripts/bootstrap-core.mjs', import.meta.url), script);
  const log = join(directory, 'commands.log');
  await writeFile(join(directory, 'docker'), '#!/bin/sh\nprintf "docker %s\\n" "$*" >> "$COMMAND_LOG"\ncase "$*" in *" ps "*) printf "[]";; *" up "*" postgres seaweedfs"*) [ "$FAIL_STEP" != services ] || exit 7;; *" run "*" app npm run db:migrate"*) [ "$FAIL_STEP" != migration ] || exit 7;; esac\n', { mode: 0o700 });
  await writeFile(join(directory, 'npm'), '#!/bin/sh\nprintf "npm %s\\n" "$*" >> "$COMMAND_LOG"\n[ "$FAIL_STEP" != migration ]\n', { mode: 0o700 });
  const expected = [
    'docker compose -f compose.yaml --env-file .env.local pull postgres seaweedfs',
    'docker compose -f compose.yaml --env-file .env.local up -d --wait postgres seaweedfs',
    'docker compose -f compose.yaml --env-file .env.local --profile production build app',
    'docker compose -f compose.yaml --env-file .env.local --profile production run --rm --no-deps app npm run db:migrate',
    'docker compose -f compose.yaml --env-file .env.local --profile production up -d --wait --no-deps app',
  ];
  for (const [step, count] of [['services', 2], ['migration', 4], ['', 5]] as const) {
    await context.test(step || 'success', async () => {
      await writeFile(log, '');
      const result = spawnSync(process.execPath, [await realpath(script), '--production', '--force'], {
        env: { PATH: directory, COMMAND_LOG: log, FAIL_STEP: step, TOME_CMS_PUBLIC_URL: 'https://cms.example.com', S3_ENDPOINT: 'https://s3.example.com', POSTGRES_PORT: '55441', S3_PORT: '55442', APP_PORT: '55444', DATABASE_CONNECTION_TIMEOUT_MS: '4000', DATABASE_QUERY_TIMEOUT_MS: '90000' },
        encoding: 'utf8', timeout: 10_000,
      });
      assert.equal(result.status, step ? 1 : 0, 'bootstrap returns the required command status');
      const commands = (await readFile(log, 'utf8')).trim().split('\n').filter(line => / (pull|up|run|build) /.test(line));
      assert.deepEqual(commands, expected.slice(0, count));
      const values = parseEnv(await readFile(join(repository, '.env.local'), 'utf8'));
      assert.equal(values.DATABASE_CONNECTION_TIMEOUT_MS, '4000');
      assert.equal(values.DATABASE_QUERY_TIMEOUT_MS, '90000');
    });
  }
});

test('empty and comment-only existing env files stop the CLI before startup', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'tomecms-empty-env-test-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'scripts'));
  const script = join(directory, 'scripts/bootstrap-core.mjs');
  await copyFile(new URL('../../scripts/bootstrap-core.mjs', import.meta.url), script);
  for (const content of ['', '# existing configuration\n']) {
    await writeFile(join(directory, '.env.local'), content, { mode: 0o600 });
    const result = spawnSync(process.execPath, [await realpath(script)], { env: { PATH: '' }, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Existing .env.local needs updates.*--force/);
    assert.doesNotMatch(result.stdout, /Starting/);
    assert.equal(await readFile(join(directory, '.env.local'), 'utf8'), content);
    const forced = spawnSync(process.execPath, [await realpath(script), '--force'], { env: { PATH: '' }, encoding: 'utf8' });
    assert.equal(forced.status, 1);
    assert.match(forced.stderr, /docker info failed/);
    assert.equal(await readFile(join(directory, '.env.local'), 'utf8'), content);
  }
});

test('environment file is private and never overwritten without force, including symlinks', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'tomecms-env-test-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, '.env.local');
  await writeEnvironment(path, 'first');
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal(await writeEnvironment(path, 'second'), false);
  assert.equal(await readFile(path, 'utf8'), 'first');
  await writeEnvironment(path, 'second', true);
  assert.equal(await readFile(path, 'utf8'), 'second');
  const link = join(directory, 'link');
  await symlink(path, link);
  await assert.rejects(writeEnvironment(link, 'third', true));
  assert.equal(await readFile(path, 'utf8'), 'second');
});
