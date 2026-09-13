import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { parseEnv } from 'node:util';

const repository = resolve(import.meta.dirname, '../..');
const commit = 'a'.repeat(40);
const digest = `sha256:${'b'.repeat(64)}`;
const image = `ghcr.io/dhanabhon/tome-cms@${digest}`;
const manifest = {
  format: 'tomecms-update', manifestVersion: 1, product: 'tomecms', channel: 'stable', version: '1.0.0',
  releasedAt: '2026-09-01T00:00:00.000Z', source: { repository: 'Dhanabhon/tome-cms', commit },
  image: { repository: 'ghcr.io/dhanabhon/tome-cms', digest, platforms: ['linux/amd64', 'linux/arm64'] },
  compatibility: { minimumDirectUpgradeFrom: '1.0.0', minimumUpdaterVersion: '1.0.0', targetMigration: '008_update_rate_limit_actions', rollbackSafeFrom: '1.0.0', composeContract: 1, environmentContract: 1, updaterProtocol: 1 },
  releaseNotesUrl: 'https://github.com/Dhanabhon/tome-cms/releases/tag/v1.0.0',
};

// Only these doubles can perform external operations. PATH never includes host executables.
const stub = `#!${process.execPath}
const fs = require('node:fs'); const path = require('node:path');
const name = path.basename(process.argv[1]); const args = process.argv.slice(2); const text = args.join(' ');
fs.appendFileSync(process.env.COMMAND_LOG, JSON.stringify([name, ...args]) + '\\n');
const fail = process.env.FAIL_STEP;
if (fail && (name + ' ' + text).includes(fail)) process.exit(7);
let output = '';
if (name === 'uname') output = args[0] === '-s' ? (process.env.HOST_OS || 'Linux') : (process.env.HOST_ARCH || 'x86_64');
if (name === 'id') output = args[0] === '-u' ? (process.env.HOST_UID || '0') : '994';
if (name === 'getent') {
  if (args[1] === 'docker') output = 'docker:x:993:';
  else process.exit(2);
}
if (name === 'git') {
  if (args.includes('describe')) output = process.env.SOURCE_TAG || 'v1.0.0';
  else if (args.includes('rev-parse')) output = process.env.SOURCE_COMMIT || '${commit}';
  else if (args.includes('status')) output = process.env.SOURCE_DIRTY || '';
}
if (name === 'curl') {
  if (args.includes('--unix-socket')) output = JSON.stringify({ protocolVersion: 1, updaterVersion: '1.0.0', managed: true, installed: { version: '1.0.0', imageDigest: '${digest}' }, job: null });
  else if (text.includes('/health/ready')) output = '{}';
  else if (text.includes('/releases/tags/')) output = fs.readFileSync(process.env.RELEASE_FIXTURE, 'utf8');
  else if (text.includes('/releases/download/')) output = fs.readFileSync(process.env.MANIFEST_FIXTURE, 'utf8');
  else output = JSON.stringify({ private: process.env.PRIVATE_REPO === '1', visibility: 'public', full_name: 'Dhanabhon/tome-cms' });
}
if (name === 'docker') {
  if (text.includes('--env-file') && process.env.TOME_CMS_APP_IMAGE) process.exit(9);
  if (text.startsWith('ps ') || text.startsWith('volume ls ')) output = process.env.ORPHAN_MIGRATION && text.includes('name=^tomecms-install-migration-') ? 'owned-container-id' : (process.env.EXISTING_DOCKER || '');
  else if (text.startsWith('image inspect ')) output = JSON.stringify([{ RepoDigests: ['${image}'], Os: 'linux', Architecture: process.env.IMAGE_ARCH || 'amd64', Config: { Labels: { 'org.opencontainers.image.version': '1.0.0', 'org.opencontainers.image.revision': '${commit}' } } }]);
  else if (text.includes('migrator.ts')) output = '["008_update_rate_limit_actions"]';
}
if (name === 'systemctl' && text === 'enable --now tomecms-updater.service') {
  const root = process.env.INSTALL_FIXTURE_ROOT;
  fs.writeFileSync(path.join(root, 'run/tome-cms/updater.sock'), 'stub socket', { mode: 0o660 });
  fs.chmodSync(path.join(root, 'run/tome-cms/updater.sock'), 0o660);
}
if (name === 'systemctl' && args[0] === '--version') output = 'systemd 252';
if (name === 'npm' && args.includes('--outDir')) {
  const target = args[args.indexOf('--outDir') + 1];
  fs.mkdirSync(path.join(target, 'updater'), { recursive: true });
  fs.copyFileSync('dist-updater/updater/main.js', path.join(target, 'updater/main.js'));
}
process.stdout.write(output);
`;

async function fixture(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'tomecms-managed-test-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source');
  const prefix = join(root, 'host');
  const bin = join(prefix, 'bin');
  await mkdir(bin, { recursive: true });
  const files = ['scripts/install-managed-vps.sh', 'scripts/bootstrap-core.mjs', 'scripts/deploy-vps.sh', 'src/update/contracts.ts', 'compose.managed.yaml', 'config/systemd/tomecms-updater.service', 'config/seaweedfs-s3.json'];
  for (const file of files) {
    const target = join(source, file);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(repository, file), target).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  await writeFile(join(source, 'package.json'), '{"type":"module","version":"1.0.0"}');
  await symlink(join(repository, 'node_modules'), join(source, 'node_modules'));
  await mkdir(join(source, 'dist-updater/updater'), { recursive: true });
  await writeFile(join(source, 'dist-updater/updater/main.js'), 'export {};\n');
  await mkdir(join(source, 'src/server/db/migrations'), { recursive: true });
  await writeFile(join(source, 'src/server/db/migrations/008_update_rate_limit_actions.ts'), 'export {};\n');
  for (const command of ['uname', 'id', 'getent', 'groupadd', 'useradd', 'chown', 'git', 'docker', 'gh', 'npm', 'curl', 'systemctl']) {
    await writeFile(join(bin, command), stub, { mode: 0o700 });
  }
  await symlink(process.execPath, join(bin, 'node'));
  const manifestFile = join(root, 'manifest.json');
  const releaseFile = join(root, 'release.json');
  const bytes = JSON.stringify(manifest) + '\n';
  const release = { tag_name: 'v1.0.0', draft: false, prerelease: false, immutable: true, html_url: manifest.releaseNotesUrl, published_at: manifest.releasedAt,
    assets: [{ name: 'update-manifest.json', browser_download_url: 'https://github.com/Dhanabhon/tome-cms/releases/download/v1.0.0/update-manifest.json', digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` }] };
  await writeFile(manifestFile, bytes);
  await writeFile(releaseFile, JSON.stringify(release));
  const log = join(root, 'commands.jsonl');
  const env = { PATH: bin, COMMAND_LOG: log, RELEASE_FIXTURE: releaseFile, MANIFEST_FIXTURE: manifestFile, INSTALL_FIXTURE_ROOT: prefix,
    TOME_CMS_PUBLIC_URL: 'https://cms.example.com', S3_ENDPOINT: 'https://media.example.com' };
  return { root, source, prefix, bin, log, release, releaseFile, manifestFile,
    run: (args: string[] = ['--dry-run'], extra: Record<string, string> = {}) => spawnSync('/bin/bash', ['-c', 'umask 077; exec /bin/bash "$@"', 'managed-test', join(source, 'scripts/install-managed-vps.sh'), ...args, '--version', '1.0.0', '--root-prefix', prefix], { cwd: source, env: { ...env, ...extra }, encoding: 'utf8', timeout: 20_000 }),
    commands: async () => (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as string[]),
    deploy: (args: string[], extra: Record<string, string> = {}) => spawnSync('/bin/bash', [join(source, 'scripts/deploy-vps.sh'), ...args], { cwd: source, env: { ...env, ...extra }, encoding: 'utf8', timeout: 20_000 }),
  };
}

test('dry-run verifies a matching release and prints a fixed plan without installing', async t => {
  const f = await fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.version, '1.0.0');
  assert.equal(plan.platform, 'linux/amd64');
  assert.equal(plan.image, image);
  assert.equal(plan.user, 'tomecms-updater');
  assert.equal(plan.group, 'tomecms-updater');
  assert.deepEqual(plan.destinations.map((item: { path: string; mode: string; owner: string }) => [item.path, item.mode, item.owner]), [
    ['/opt/tome-cms', '0755', 'root:root'],
    ['/opt/tome-cms/compose.managed.yaml', '0644', 'root:root'],
    ['/opt/tome-cms/config', '0755', 'root:root'],
    ['/opt/tome-cms/config/seaweedfs-s3.json', '0644', 'root:root'],
    ['/opt/tome-cms/updater', '0755', 'root:root'],
    ['/etc/tome-cms', '0750', 'root:tomecms-updater'],
    ['/etc/tome-cms/tome-cms.env', '0640', 'root:tomecms-updater'],
    ['/etc/tome-cms/updater.json', '0644', 'root:root'],
    ['/var/lib/tome-cms', '0700', 'tomecms-updater:tomecms-updater'],
    ['/var/lib/tome-cms/updater', '0700', 'tomecms-updater:tomecms-updater'],
    ['/var/lib/tome-cms/updater/image.env', '0600', 'tomecms-updater:tomecms-updater'],
    ['/var/lib/tome-cms/updater/installed.json', '0600', 'tomecms-updater:tomecms-updater'],
    ['/var/backups/tome-cms', '0700', 'tomecms-updater:tomecms-updater'],
    ['/var/log/tome-cms', '0700', 'tomecms-updater:tomecms-updater'],
    ['/run/tome-cms', '0750', 'tomecms-updater:tomecms-updater'],
    ['/etc/systemd/system/tomecms-updater.service', '0644', 'root:root'],
  ]);
  assert.equal(plan.destinations.find((item: { path: string }) => item.path === '/etc/tome-cms/tome-cms.env').mode, '0640');
  assert.deepEqual(plan.steps, ['build-updater', 'pull-image', 'create-account', 'install-files', 'start-infrastructure', 'migrate', 'start-app', 'readiness', 'start-updater', 'socket-status']);
  const commands = await f.commands();
  assert.equal(commands.filter(args => args[0] === 'gh' && args[1] === 'attestation').length, 2);
  assert.ok(commands.some(args => args.includes(`oci://${image}`)));
  assert.ok(!commands.some(args => ['npm', 'useradd', 'groupadd', 'chown'].includes(args[0]) || args.includes('pull') || args.includes('enable')));
  assert.deepEqual(await readdir(f.prefix), ['bin']);
});

test('production wrapper delegates only matching stable tagged production installs', async t => {
  const f = await fixture(t);
  const managed = f.deploy(['--dry-run', '--root-prefix', f.prefix]);
  assert.equal(managed.status, 0, managed.stderr);
  assert.equal(JSON.parse(managed.stdout).version, '1.0.0');
  const local = await fixture(t);
  await writeFile(join(local.source, 'package.json'), '{"type":"module","version":"0.2.0"}');
  const source = local.deploy([], { SOURCE_TAG: 'v0.2.0', POSTGRES_PORT: '55441', S3_PORT: '55442', APP_PORT: '55444' });
  assert.equal(source.status, 0, source.stderr);
  assert.equal(parseEnv(await readFile(join(local.source, '.env.local'), 'utf8')).TOME_CMS_UPDATE_MODE, 'check-only');
  assert.ok((await local.commands()).some(args => args.includes('build') && args.includes('app')));
});

test('installer rejects unsafe prerequisites before any deployment mutation', async t => {
  for (const [extra, expected] of [
    [{ HOST_OS: 'Darwin' }, /Linux/], [{ HOST_ARCH: 'riscv64' }, /architecture/],
    [{ SOURCE_TAG: 'v1.0.1' }, /tag/], [{ SOURCE_DIRTY: ' M scripts/installer' }, /clean/],
    [{ PRIVATE_REPO: '1' }, /public/], [{ FAIL_STEP: 'docker compose version' }, /docker/],
    [{ FAIL_STEP: 'gh attestation verify oci:' }, /gh/], [{ EXISTING_DOCKER: 'tomecms_postgres-data' }, /fresh/],
  ] as Array<[Record<string, string>, RegExp]>) {
    await t.test(JSON.stringify(extra), async t => {
      const f = await fixture(t);
      const result = f.run([], extra);
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, expected);
      assert.deepEqual(await readdir(f.prefix), ['bin']);
    });
  }
  const f = await fixture(t);
  assert.match(f.run([], { HOST_UID: '501' }).stderr, /root/);
  await rm(join(f.bin, 'gh'));
  assert.match(f.run().stderr, /Missing.*gh/);
});

test('manifest, package, asset digest, source commit and release immutability must agree', async t => {
  for (const change of ['package', 'mutable', 'digest', 'commit', 'platform', 'unknown', 'version', 'contract'] as const) {
    await t.test(change, async t => {
      const f = await fixture(t);
      if (change === 'package') await writeFile(join(f.source, 'package.json'), '{"type":"module","version":"0.2.0"}');
      else if (change === 'mutable') await writeFile(f.releaseFile, JSON.stringify({ ...f.release, immutable: false }));
      else if (change === 'digest') await writeFile(f.manifestFile, '{}');
      else {
        const value = structuredClone(manifest);
        if (change === 'commit') value.source.commit = 'c'.repeat(40);
        if (change === 'platform') value.image.platforms = ['linux/arm64'];
        if (change === 'version') value.version = '1.0.1';
        if (change === 'contract') value.compatibility.composeContract = 2;
        const bytes = JSON.stringify(change === 'unknown' ? { ...value, command: 'bad' } : value);
        await writeFile(f.manifestFile, bytes);
        await writeFile(f.releaseFile, JSON.stringify({ ...f.release, assets: [{ ...f.release.assets[0], digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` }] }));
      }
      const result = f.run();
      assert.equal(result.status, 1, result.stdout);
      assert.deepEqual(await readdir(f.prefix), ['bin']);
    });
  }
});

test('symlink ancestors and existing unmanaged files are never overwritten', async t => {
  const f = await fixture(t);
  await mkdir(join(f.prefix, 'etc/tome-cms'), { recursive: true });
  const secret = join(f.prefix, 'etc/tome-cms/tome-cms.env');
  await writeFile(secret, 'KEEP=private\n');
  assert.match(f.run().stderr, /fresh/);
  assert.equal(await readFile(secret, 'utf8'), 'KEEP=private\n');
  const other = await fixture(t);
  await symlink(f.prefix, join(other.prefix, 'etc'));
  assert.match(other.run().stderr, /symlink/);
});

test('installation writes private fixed state, then migrates before app and socket readiness', async t => {
  const f = await fixture(t);
  const result = f.run([], { TOME_CMS_APP_IMAGE: 'untrusted:latest' });
  assert.equal(result.status, 0, result.stderr);
  const envPath = join(f.prefix, 'etc/tome-cms/tome-cms.env');
  const env = parseEnv(await readFile(envPath, 'utf8'));
  assert.equal(env.TOME_CMS_UPDATE_MODE, 'managed');
  assert.equal(env.TOME_CMS_UPDATER_GID, '994');
  assert.equal((await stat(envPath)).mode & 0o777, 0o640);
  assert.equal((await stat(join(f.prefix, 'var/backups/tome-cms'))).mode & 0o777, 0o700);
  assert.equal((await stat(join(f.prefix, 'var/backups'))).mode & 0o777, 0o755);
  assert.equal((await stat(join(f.prefix, 'etc/systemd/system'))).mode & 0o777, 0o755);
  const installed = JSON.parse(await readFile(join(f.prefix, 'var/lib/tome-cms/updater/installed.json'), 'utf8'));
  assert.equal(installed.version, '1.0.0');
  assert.equal(installed.imageDigest, digest);
  assert.equal((await stat(join(f.prefix, 'var/lib/tome-cms/updater/image.env'))).mode & 0o777, 0o600);
  assert.equal(await readFile(join(f.prefix, 'var/lib/tome-cms/updater/image.env'), 'utf8'), `TOME_CMS_APP_IMAGE='${image}'\n`);
  await assert.rejects(access(join(f.source, '.env.local')));
  assert.ok(env.TOME_CMS_INSTALL_TOKEN);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(env.TOME_CMS_INSTALL_TOKEN));
  const commands = (await f.commands()).map(args => args.join(' '));
  const steps = ['npm run build:updater', `docker pull ${image}`, 'groupadd --system tomecms-updater', 'up -d --wait --wait-timeout 90 postgres seaweedfs', 'app npm run db:migrate', 'up -d --wait --wait-timeout 90 --no-deps --pull never app', '/health/ready', 'systemctl enable --now tomecms-updater.service', '--unix-socket'];
  let previous = -1;
  for (const step of steps) {
    const index = commands.findIndex((line, i) => i > previous && line.includes(step));
    assert.ok(index > previous, `missing ordered step ${step}`);
    previous = index;
  }
  assert.ok(!commands.some(line => /sudo|docker.sock| down |volume rm/.test(line)));
});

test('a failed migration cleans only its named one-shot container and retains recovery files', async t => {
  const f = await fixture(t);
  const result = f.run([], { FAIL_STEP: 'app npm run db:migrate', ORPHAN_MIGRATION: '1' });
  assert.equal(result.status, 1);
  const commands = await f.commands();
  const removal = commands.find(args => args[0] === 'docker' && args[1] === 'rm');
  assert.ok(removal);
  assert.equal(removal[2], '--force');
  assert.match(removal[3], /^tomecms-install-migration-[0-9a-f-]{36}$/);
  await access(join(f.prefix, 'etc/tome-cms/tome-cms.env'));
  assert.match(result.stderr, /retained/);
});

test('installer builds into a clean output directory instead of installing stale ignored build files', async t => {
  const f = await fixture(t);
  await writeFile(join(f.source, 'dist-updater/stale.js'), 'unrelated ignored output');
  const result = f.run([]);
  assert.equal(result.status, 0, result.stderr);
  await assert.rejects(access(join(f.prefix, 'opt/tome-cms/updater/stale.js')));
  assert.equal(await readFile(join(f.prefix, 'opt/tome-cms/updater/updater/main.js'), 'utf8'), 'export {};\n');
});

test('pre-migration failures keep generated secrets and data; migration and readiness failures retain recovery state', async t => {
  for (const step of ['docker pull', 'postgres seaweedfs', 'app npm run db:migrate', '/health/ready', 'systemctl enable']) {
    await t.test(step, async t => {
      const f = await fixture(t);
      const result = f.run([], { FAIL_STEP: step });
      assert.equal(result.status, 1);
      const commands = (await f.commands()).map(args => args.join(' '));
      assert.ok(commands.some(line => line.includes(step)), `failure injection reached ${step}`);
      assert.ok(!commands.some(line => / down |volume rm|image rm/.test(line)));
      if (step === 'docker pull') await assert.rejects(access(join(f.prefix, 'etc/tome-cms/tome-cms.env')));
      else {
        await access(join(f.prefix, 'etc/tome-cms/tome-cms.env'));
        assert.match(result.stderr, /recovery|retained/i);
      }
    });
  }
});
