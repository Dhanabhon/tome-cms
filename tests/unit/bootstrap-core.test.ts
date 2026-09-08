import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { parseOptions, renderEnvironment, writeEnvironment, verifyLicense, makeEnvironment } from '../../scripts/bootstrap-core.mjs';

test('test-license CLI fails before startup without printing supplied secrets', () => {
  const result = spawnSync(process.execPath, ['scripts/bootstrap-core.mjs', '--check-test-license'], {
    env: { ...process.env, MINIO_LICENSE_FILE: '', S3_SECRET_ACCESS_KEY: 'PRIVATE_TEST_SENTINEL' }, encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /MINIO_LICENSE_FILE/);
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_TEST_SENTINEL/);
});

test('bootstrap options default to local, select production and reject unknown flags', () => {
  assert.deepEqual(parseOptions([]), { production: false, force: false, checkTestLicense: false });
  assert.equal(parseOptions(['--production', '--force']).production, true);
  assert.equal(parseOptions(['--production', '--force']).force, true);
  assert.throws(() => parseOptions(['--produciton']), /Unknown option/);
});

test('environment renders required values once with literal secrets and rejects injection', () => {
  const values = makeEnvironment({ MINIO_LICENSE_FILE: '/external/aistor.license' }, false);
  const rendered = renderEnvironment(values);
  assert.deepEqual(parseEnv(rendered), values);
  assert.equal(rendered.match(/^MINIO_LICENSE_FILE=/gm)?.length, 1);
  for (const key of ['TOME_CMS_INSTALL_TOKEN', 'BETTER_AUTH_SECRET', 'TOME_CMS_CONTEXT_SECRET', 'TOME_CMS_RECOVERY_PEPPER', 'POSTGRES_PASSWORD', 'S3_SECRET_ACCESS_KEY']) {
    assert.match(values[key], /^[A-Za-z0-9_-]{43}$/);
    assert.equal(rendered.match(new RegExp(`^${key}=`, 'gm'))?.length, 1);
  }
  assert.throws(() => renderEnvironment({ ...values, MINIO_LICENSE_FILE: 'relative' }), /MINIO_LICENSE_FILE/);
  assert.throws(() => renderEnvironment({ ...values, BETTER_AUTH_SECRET: '' }), /BETTER_AUTH_SECRET/);
  assert.throws(() => renderEnvironment({ ...values, BAD: "one\nBAD=two" }), /BAD/);
  assert.throws(() => renderEnvironment({ ...values, 'BAD\nKEY': 'value' }), /key/);
  assert.equal(parseEnv(renderEnvironment({ ...values, CUSTOM: '$not_interpolated#value' })).CUSTOM, '$not_interpolated#value');
});

test('existing secrets survive reruns and production requires explicit HTTPS URLs', () => {
  const original = makeEnvironment({ MINIO_LICENSE_FILE: '/external/license' }, false);
  assert.deepEqual(makeEnvironment(original, false), original);
  assert.throws(() => makeEnvironment(original, true), /HTTPS/);
  const production = makeEnvironment({ ...original, TOME_CMS_PUBLIC_URL: 'https://cms.example.com', S3_ENDPOINT: 'https://s3.example.com', MEDIA_PUBLIC_URL: 'https://s3.example.com/tomecms-media/' }, true);
  assert.equal(production.NODE_ENV, 'production');
  assert.equal(production.BETTER_AUTH_SECRET, original.BETTER_AUTH_SECRET);
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

test('license must be a nonempty readable regular file outside repo, even through symlinks', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'tomecms-license-test-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const license = join(directory, 'test.license');
  await writeFile(license, 'test fixture, not a real license');
  assert.equal(await verifyLicense(license, join(directory, 'repo')), await realpath(license));
  await assert.rejects(verifyLicense(undefined, directory), /MINIO_LICENSE_FILE/);
  await assert.rejects(verifyLicense('relative', directory), /absolute/);
  await assert.rejects(verifyLicense('/dev/null', directory), /regular/);
  await assert.rejects(verifyLicense(license, directory), /outside/);
  const link = join(directory, 'alias');
  await symlink(license, link);
  await assert.rejects(verifyLicense(link, directory), /outside/);
  await mkdir(join(directory, '.git'));
  await assert.rejects(verifyLicense(license, join(directory, '.worktrees', 'nested')), /outside/);
});
