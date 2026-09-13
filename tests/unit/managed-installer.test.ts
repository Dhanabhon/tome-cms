import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { parseEnv } from 'node:util';

const repository = resolve(import.meta.dirname, '../..');
const commit = 'a'.repeat(40);
const digest = `sha256:${'b'.repeat(64)}`;
const image = `ghcr.io/dhanabhon/tome-cms@${digest}`;
const bundleNames = ['update-manifest.attestation.json', 'tomecms-image.attestation.json'] as const;
const bundleBytes = ['{"bundle":"manifest"}\n', '{"bundle":"image"}\n'];
const githubOverrides = ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_HOST', 'GITHUB_HOST', 'GH_ENTERPRISE_HOST', 'GITHUB_ENTERPRISE_HOST', 'GITHUB_API_URL', 'GITHUB_GRAPHQL_URL', 'GITHUB_SERVER_URL', 'GH_REPO'];
const dockerRegistryOverrides = ['DOCKER_AUTH_CONFIG', 'REGISTRY_AUTH_FILE', 'DOCKER_CONTENT_TRUST', 'DOCKER_CONTENT_TRUST_SERVER', 'DOCKER_CONTENT_TRUST_REPOSITORY_PASSPHRASE', 'DOCKER_CONTENT_TRUST_ROOT_PASSPHRASE'];
const dockerDaemonSelectors = ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'];
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
if (fail && (name + ' ' + text).includes(fail)) {
  if (process.env.FAIL_PRIVATE_DETAILS) {
    const values = require('node:util').parseEnv(fs.readFileSync(path.join(process.env.INSTALL_FIXTURE_ROOT, 'etc/tome-cms/tome-cms.env'), 'utf8'));
    const sensitive = Object.entries(values).filter(([key]) => /PASSWORD|TOKEN|SECRET|KEY|PEPPER|DATABASE_URL/.test(key)).map(([, value]) => value);
    const forms = sensitive.flatMap(value => [value, encodeURIComponent(value), encodeURI(value), new URLSearchParams({ value }).toString().slice(6), JSON.stringify(value).slice(1, -1), Buffer.from(value).toString('base64'), Buffer.from(value).toString('base64url')]);
    process.stdout.write('Migration 008_update_rate_limit_actions started\\n' + forms.join('\\n') + '\\n');
    process.stderr.write('SQLSTATE 23505: duplicate migration record\\n' + forms.join('\\n') + '\\n' + 'x'.repeat(20000));
  }
  process.exit(7);
}
let output = '';
if (name === 'uname') output = args[0] === '-s' ? (process.env.HOST_OS || 'Linux') : (process.env.HOST_ARCH || 'x86_64');
const identity = kind => path.join(process.env.IDENTITY_STATE, kind);
if (name === 'id') {
  if (args[0] === '-u') output = process.env.HOST_UID || '0';
  else if (fs.existsSync(identity('user'))) output = '994';
  else process.exit(1);
}
if (name === 'getent') {
  if (args[1] === 'docker') output = 'docker:x:993:';
  else if (args[1] === 'tomecms-updater' && fs.existsSync(identity(args[0] === 'passwd' ? 'user' : 'group'))) output = 'tomecms-updater:x:994:';
  else process.exit(2);
}
if (name === 'groupadd') {
  if (fs.existsSync(identity('group'))) process.exit(9);
  fs.mkdirSync(process.env.IDENTITY_STATE, { recursive: true });
  fs.writeFileSync(identity('group'), '994');
}
if (name === 'useradd') {
  if (!fs.existsSync(identity('group')) || fs.existsSync(identity('user'))) process.exit(9);
  fs.writeFileSync(identity('user'), '994');
}
if (name === 'userdel') fs.rmSync(identity('user'), { force: true });
if (name === 'groupdel') {
  if (fs.existsSync(identity('user'))) process.exit(9);
  fs.rmSync(identity('group'), { force: true });
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
  else if (text.includes('/releases/download/')) {
    const file = path.basename(args.at(-1));
    const files = { 'update-manifest.json': process.env.MANIFEST_FIXTURE, 'update-manifest.attestation.json': process.env.MANIFEST_BUNDLE_FIXTURE, 'tomecms-image.attestation.json': process.env.IMAGE_BUNDLE_FIXTURE };
    if (!files[file]) process.exit(8);
    output = fs.readFileSync(files[file], 'utf8');
  }
  else output = JSON.stringify({ private: process.env.PRIVATE_REPO === '1', visibility: 'public', full_name: 'Dhanabhon/tome-cms' });
}
if (name === 'docker') {
  const configPath = process.env.DOCKER_CONFIG;
  const config = configPath && fs.existsSync(configPath) ? { mode: fs.statSync(configPath).mode & 0o777, entries: fs.readdirSync(configPath) } : null;
  const envNames = ${JSON.stringify(['HOME', 'DOCKER_CONFIG', 'DOCKER_AUTH_CONFIG', 'REGISTRY_AUTH_FILE', 'DOCKER_CONTENT_TRUST', 'DOCKER_CONTENT_TRUST_SERVER', 'DOCKER_CONTENT_TRUST_REPOSITORY_PASSPHRASE', 'DOCKER_CONTENT_TRUST_ROOT_PASSPHRASE', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'])};
  const env = Object.fromEntries(envNames.map(key => [key, process.env[key] || null]));
  fs.appendFileSync(process.env.DOCKER_EVENT_LOG, JSON.stringify({ args, env, config }) + '\\n');
  if (args[0] === 'rm' && process.env.FAIL_PRIVATE_DETAILS) {
    const logRoot = path.join(process.env.INSTALL_FIXTURE_ROOT, 'var/log/tome-cms');
    const logs = fs.readdirSync(logRoot).filter(file => file.startsWith('install-'));
    fs.appendFileSync(process.env.COMMAND_LOG, JSON.stringify(['diagnostics-before-cleanup', logs.length ? fs.readFileSync(path.join(logRoot, logs[0]), 'utf8') : '']) + '\\n');
  }
  if (text.includes('--env-file') && process.env.TOME_CMS_APP_IMAGE) process.exit(9);
  if (text.startsWith('ps ') || text.startsWith('volume ls ')) output = process.env.ORPHAN_MIGRATION && text.includes('name=^tomecms-install-migration-') ? 'owned-container-id' : (process.env.EXISTING_DOCKER || '');
  else if (text.startsWith('image inspect ')) output = JSON.stringify([{ RepoDigests: ['${image}'], Os: 'linux', Architecture: process.env.IMAGE_ARCH || 'amd64', Config: { Labels: { 'org.opencontainers.image.version': '1.0.0', 'org.opencontainers.image.revision': '${commit}' } } }]);
  else if (text.includes('migrator.ts')) output = '["008_update_rate_limit_actions"]';
}
if (name === 'gh' && args[0] === 'attestation') {
  const bundle = args.includes('--bundle') ? args[args.indexOf('--bundle') + 1] : '';
  const directory = bundle ? path.dirname(bundle) : (args[2].startsWith('oci:') ? '' : path.dirname(args[2]));
  const names = ['update-manifest.json', 'update-manifest.attestation.json', 'tomecms-image.attestation.json'];
  const assets = names.map(name => { const file = path.join(directory, name); return directory && fs.existsSync(file) ? { name, mode: fs.statSync(file).mode & 0o777, bytes: fs.readFileSync(file, 'utf8') } : { name }; });
  const env = Object.fromEntries(${JSON.stringify([...githubOverrides, 'GH_CONFIG_DIR', 'XDG_CACHE_HOME', 'GH_PROMPT_DISABLED', 'HOME', 'DOCKER_CONFIG', ...dockerRegistryOverrides, ...dockerDaemonSelectors])}.map(name => [name, process.env[name] || null]));
  const modes = ['GH_CONFIG_DIR', 'XDG_CACHE_HOME'].map(key => env[key] && fs.existsSync(env[key]) ? fs.statSync(env[key]).mode & 0o777 : null);
  for (const key of ['GH_CONFIG_DIR', 'XDG_CACHE_HOME']) if (env[key] && fs.existsSync(env[key])) fs.writeFileSync(path.join(env[key], 'write-probe'), 'private cache', { mode: 0o600 });
  fs.appendFileSync(process.env.GH_EVENT_LOG, JSON.stringify({ args, directory, assets, env, modes }) + '\\n');
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
  for (const command of ['uname', 'id', 'getent', 'groupadd', 'groupdel', 'useradd', 'userdel', 'chown', 'git', 'docker', 'gh', 'npm', 'curl', 'systemctl']) {
    await writeFile(join(bin, command), stub, { mode: 0o700 });
  }
  await symlink(process.execPath, join(bin, 'node'));
  const manifestFile = join(root, 'manifest.json');
  const releaseFile = join(root, 'release.json');
  const bundleFiles = bundleNames.map(name => join(root, name));
  const bytes = JSON.stringify(manifest) + '\n';
  const release = { tag_name: 'v1.0.0', draft: false, prerelease: false, immutable: true, html_url: manifest.releaseNotesUrl, published_at: manifest.releasedAt,
    assets: [{ name: 'update-manifest.json', browser_download_url: 'https://github.com/Dhanabhon/tome-cms/releases/download/v1.0.0/update-manifest.json', digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` }, ...bundleNames.map((name, i) => ({ name, browser_download_url: `https://github.com/Dhanabhon/tome-cms/releases/download/v1.0.0/${name}`, digest: `sha256:${createHash('sha256').update(bundleBytes[i]).digest('hex')}` }))] };
  await writeFile(manifestFile, bytes);
  for (let i = 0; i < bundleFiles.length; i++) await writeFile(bundleFiles[i], bundleBytes[i]);
  await writeFile(releaseFile, JSON.stringify(release));
  const log = join(root, 'commands.jsonl');
  const ghLog = join(root, 'gh.jsonl');
  const dockerLog = join(root, 'docker.jsonl');
  const env = { PATH: bin, HOME: join(root, 'home'), COMMAND_LOG: log, GH_EVENT_LOG: ghLog, DOCKER_EVENT_LOG: dockerLog, IDENTITY_STATE: join(root, 'identity'), RELEASE_FIXTURE: releaseFile, MANIFEST_FIXTURE: manifestFile, MANIFEST_BUNDLE_FIXTURE: bundleFiles[0], IMAGE_BUNDLE_FIXTURE: bundleFiles[1], INSTALL_FIXTURE_ROOT: prefix,
    TOME_CMS_PUBLIC_URL: 'https://cms.example.com', S3_ENDPOINT: 'https://media.example.com' };
  return { root, source, prefix, bin, log, ghLog, dockerLog, release, releaseFile, manifestFile, bundleFiles,
    run: (args: string[] = ['--dry-run'], extra: Record<string, string> = {}) => spawnSync('/bin/bash', ['-c', 'umask 077; exec /bin/bash "$@"', 'managed-test', join(source, 'scripts/install-managed-vps.sh'), ...args, '--version', '1.0.0', '--root-prefix', prefix], { cwd: source, env: { ...env, ...extra }, encoding: 'utf8', timeout: 20_000 }),
    commands: async () => (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as string[]),
    dockerEvents: async () => (await readFile(dockerLog, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)),
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
    ['/var/lib/tome-cms/updater/docker-public', '0700', 'tomecms-updater:tomecms-updater'],
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

test('installer verifies downloaded bundles with fixed provenance and isolated writable GitHub directories', async t => {
  const f = await fixture(t);
  const inherited = Object.fromEntries([...githubOverrides, 'GH_CONFIG_DIR', 'XDG_CACHE_HOME'].map(name => [name, 'must-not-reach-gh']));
  const result = f.run(['--dry-run'], inherited);
  assert.equal(result.status, 0, result.stderr);
  const events = (await readFile(f.ghLog, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(events.length, 2);
  for (const [index, event] of events.entries()) {
    assert.deepEqual(event.args, ['attestation', 'verify', index ? `oci://${image}` : join(event.directory, 'update-manifest.json'), '--bundle', join(event.directory, bundleNames[index]), '-R', 'Dhanabhon/tome-cms', '--signer-workflow', 'Dhanabhon/tome-cms/.github/workflows/release.yml', '--source-ref', 'refs/tags/v1.0.0', '--source-digest', commit, '--deny-self-hosted-runners']);
    assert.deepEqual(event.assets.map((asset: { mode: number }) => asset.mode), [0o600, 0o600, 0o600]);
    assert.deepEqual(event.assets.map((asset: { bytes: string }) => asset.bytes), [await readFile(f.manifestFile, 'utf8'), ...bundleBytes]);
    for (const key of githubOverrides) assert.equal(event.env[key], null, key);
    assert.equal(event.env.GH_PROMPT_DISABLED, '1');
    assert.deepEqual(event.modes, [0o700, 0o700]);
    for (const key of ['GH_CONFIG_DIR', 'XDG_CACHE_HOME']) {
      assert.equal(dirname(event.env[key]), event.directory);
      await assert.rejects(access(event.env[key]));
    }
    await assert.rejects(access(event.directory));
  }
  const downloads = (await f.commands()).filter(args => args[0] === 'curl' && args.at(-1)?.includes('/releases/download/'));
  assert.deepEqual(downloads.map(args => args.at(-1)), ['update-manifest.json', ...bundleNames].map(name => `https://github.com/Dhanabhon/tome-cms/releases/download/v1.0.0/${name}`));
  for (const args of downloads) {
    assert.equal(args[args.indexOf('--max-filesize') + 1], '524288');
    assert.equal(args[args.indexOf('--max-time') + 1], '5');
  }
});

test('registry access ignores ambient credentials on the supported local Docker daemon', async t => {
  const f = await fixture(t);
  const hostileHome = join(f.root, 'hostile-home');
  const hostileConfig = join(f.root, 'hostile-docker');
  await mkdir(join(hostileHome, '.docker'), { recursive: true, mode: 0o700 });
  await mkdir(hostileConfig, { mode: 0o700 });
  await writeFile(join(hostileHome, '.docker/config.json'), '{"auths":{"ghcr.io":{"auth":"customer-home"}}}\n', { mode: 0o600 });
  await writeFile(join(hostileConfig, 'config.json'), '{"auths":{"ghcr.io":{"auth":"customer-config"}}}\n', { mode: 0o600 });
  const inherited = {
    HOME: hostileHome,
    DOCKER_CONFIG: hostileConfig,
    DOCKER_AUTH_CONFIG: '{"auths":{"ghcr.io":{"auth":"customer-env"}}}',
    REGISTRY_AUTH_FILE: join(f.root, 'registry-auth.json'),
    DOCKER_CONTENT_TRUST: '1',
    DOCKER_CONTENT_TRUST_SERVER: 'https://attacker.example',
    DOCKER_CONTENT_TRUST_REPOSITORY_PASSPHRASE: 'repository-secret',
    DOCKER_CONTENT_TRUST_ROOT_PASSPHRASE: 'root-secret',
    DOCKER_HOST: 'unix:///var/run/docker.sock',
  };
  const result = f.run([], inherited);
  assert.equal(result.status, 0, result.stderr);
  const dockerEvents = await f.dockerEvents();
  assert.ok(dockerEvents.some(event => event.args[0] === 'pull'));
  assert.ok(dockerEvents.some(event => event.args[0] === 'image' && event.args[1] === 'inspect'));
  for (const event of dockerEvents) {
    assert.notEqual(event.env.HOME, hostileHome);
    assert.notEqual(event.env.DOCKER_CONFIG, hostileConfig);
    assert.equal(dirname(event.env.HOME), dirname(event.env.DOCKER_CONFIG));
    assert.deepEqual(event.config, { mode: 0o700, entries: [] });
    for (const key of dockerRegistryOverrides) assert.equal(event.env[key], null, key);
    for (const key of dockerDaemonSelectors) assert.equal(event.env[key], inherited[key as keyof typeof inherited] || null, key);
  }
  const ghEvents = (await readFile(f.ghLog, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const imageVerification = ghEvents.find(event => event.args[2]?.startsWith('oci://'));
  assert.ok(imageVerification);
  assert.equal(dirname(imageVerification.env.HOME), dirname(imageVerification.env.DOCKER_CONFIG));
  assert.notEqual(imageVerification.env.DOCKER_CONFIG, hostileConfig);
  for (const key of dockerRegistryOverrides) assert.equal(imageVerification.env[key], null, key);
  for (const key of dockerDaemonSelectors) assert.equal(imageVerification.env[key], inherited[key as keyof typeof inherited] || null, key);
});

test('named Docker context is resolved before its credential-bearing config is isolated', async t => {
  const f = await fixture(t);
  const hostileHome = join(f.root, 'hostile-home');
  const hostileConfig = join(f.root, 'hostile-docker');
  const contextName = 'production';
  const contextId = createHash('sha256').update(contextName).digest('hex');
  await mkdir(join(hostileHome, '.docker'), { recursive: true, mode: 0o700 });
  await mkdir(join(hostileConfig, 'contexts/meta', contextId), { recursive: true, mode: 0o700 });
  await writeFile(join(hostileConfig, 'config.json'), JSON.stringify({
    auths: { 'ghcr.io': { auth: 'customer-config' } },
    currentContext: contextName,
  }), { mode: 0o600 });
  await writeFile(join(hostileConfig, 'contexts/meta', contextId, 'meta.json'), JSON.stringify({
    Name: contextName,
    Endpoints: { docker: { Host: 'unix:///var/run/docker.sock', SkipTLSVerify: false } },
  }), { mode: 0o600 });
  const result = f.run([], {
    HOME: hostileHome,
    DOCKER_CONFIG: hostileConfig,
    DOCKER_AUTH_CONFIG: '{"auths":{"ghcr.io":{"auth":"customer-env"}}}',
  });
  assert.equal(result.status, 0, result.stderr);
  for (const event of await f.dockerEvents()) {
    assert.equal(event.env.DOCKER_HOST, 'unix:///var/run/docker.sock');
    assert.equal(event.env.DOCKER_CONTEXT, null);
    assert.notEqual(event.env.DOCKER_CONFIG, hostileConfig);
    assert.deepEqual(event.config, { mode: 0o700, entries: [] });
  }
});

test('remote and alternate Docker endpoints fail before installation mutation', async t => {
  for (const [name, endpoint, named] of [
    ['TCP', 'tcp://docker.example:2376', false],
    ['SSH', 'ssh://docker.example', false],
    ['alternate Unix socket', 'unix:///run/operator-docker.sock', false],
    ['named remote context', 'tcp://docker.example:2376', true],
  ] as const) {
    await t.test(name, async t => {
      const f = await fixture(t);
      const extra: Record<string, string> = {};
      if (named) {
        const contextName = 'production';
        const contextId = createHash('sha256').update(contextName).digest('hex');
        const dockerConfig = join(f.root, 'hostile-docker');
        await mkdir(join(dockerConfig, 'contexts/meta', contextId), { recursive: true, mode: 0o700 });
        await writeFile(join(dockerConfig, 'config.json'), JSON.stringify({
          auths: { 'ghcr.io': { auth: 'customer-config' } },
          currentContext: contextName,
        }), { mode: 0o600 });
        await writeFile(join(dockerConfig, 'contexts/meta', contextId, 'meta.json'), JSON.stringify({
          Name: contextName,
          Endpoints: { docker: { Host: endpoint, SkipTLSVerify: false } },
        }), { mode: 0o600 });
        extra.DOCKER_CONFIG = dockerConfig;
      } else extra.DOCKER_HOST = endpoint;
      const result = f.run([], extra);
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, /Managed installation requires the local Docker daemon at unix:\/\/\/var\/run\/docker\.sock\./);
      assert.deepEqual(await readdir(f.prefix), ['bin']);
      assert.ok(!(await f.commands()).some(args => args[0] === 'docker'));
    });
  }
});

test('installed updater service uses an empty private Docker credential directory', async t => {
  const f = await fixture(t);
  const result = f.run([]);
  assert.equal(result.status, 0, result.stderr);
  const dockerConfig = join(f.prefix, 'var/lib/tome-cms/updater/docker-public');
  assert.equal((await stat(dockerConfig)).mode & 0o777, 0o700);
  assert.deepEqual(await readdir(dockerConfig), []);
  const service = await readFile(join(f.prefix, 'etc/systemd/system/tomecms-updater.service'), 'utf8');
  assert.match(service, /^Environment=HOME=\/nonexistent DOCKER_CONFIG=\/var\/lib\/tome-cms\/updater\/docker-public$/m);
  assert.match(service, /^UnsetEnvironment=DOCKER_AUTH_CONFIG REGISTRY_AUTH_FILE DOCKER_CONTENT_TRUST DOCKER_CONTENT_TRUST_SERVER DOCKER_CONTENT_TRUST_REPOSITORY_PASSPHRASE DOCKER_CONTENT_TRUST_ROOT_PASSPHRASE$/m);
});

test('account setup failures roll back only this installer identity and permit retry', async t => {
  for (const step of ['groupadd --system', 'useradd --system', 'id -g tomecms-updater', 'chown root:root']) {
    await t.test(step, async t => {
      const f = await fixture(t);
      const failed = f.run([], { FAIL_STEP: step });
      assert.equal(failed.status, 1, failed.stdout);
      assert.deepEqual(await readdir(f.prefix), ['bin']);
      const retried = f.run([]);
      assert.equal(retried.status, 0, `${retried.stdout}\n${retried.stderr}`);
      const commands = await f.commands();
      assert.ok(!commands.some(args => args[0] === 'userdel' && args.join(' ') !== 'userdel tomecms-updater'));
      assert.ok(!commands.some(args => args[0] === 'groupdel' && args.join(' ') !== 'groupdel tomecms-updater'));
      assert.ok(!commands.some(args => /(^| )down( |$)|volume rm|image rm/.test(args.join(' '))));
    });
  }
});

test('incomplete recovery-set writes roll back invocation files and permit retry', async t => {
  for (const [stage, failure] of [
    ['environment', 'tome-cms.env.'],
    ['updater copy', '/updater/updater/main.js'],
    ['updater config', '/etc/tome-cms/updater.json.'],
    ['image selection', '/updater/image.env.'],
    ['installed state', '/updater/installed.json.'],
  ]) {
    await t.test(stage, async t => {
      const f = await fixture(t);
      const failed = f.run([], { FAIL_STEP: failure });
      assert.equal(failed.status, 1, failed.stdout);
      assert.doesNotMatch(failed.stderr, /Manual recovery:/);
      assert.deepEqual(await readdir(f.prefix), ['bin']);
      const retried = f.run([]);
      assert.equal(retried.status, 0, `${retried.stdout}\n${retried.stderr}`);
      const commands = await f.commands();
      assert.ok(!commands.some(args => /(^| )down( |$)|volume rm|image rm/.test(args.join(' '))));
    });
  }
});

test('rollback preserves an empty destination that predates this invocation', async t => {
  const f = await fixture(t);
  const existing = join(f.prefix, 'etc/tome-cms');
  await mkdir(existing, { recursive: true });
  await chmod(existing, 0o711);
  const failed = f.run([], { FAIL_STEP: 'tome-cms.env.' });
  assert.equal(failed.status, 1, failed.stdout);
  assert.equal((await stat(existing)).mode & 0o777, 0o711);
  assert.deepEqual(await readdir(existing), []);
  const retried = f.run([]);
  assert.equal(retried.status, 0, `${retried.stdout}\n${retried.stderr}`);
});

test('missing, duplicate, redirected, invalid and oversized bundles fail closed before verification or mutation', async t => {
  for (const [index, name] of bundleNames.entries()) {
    for (const mutation of ['missing', 'duplicate', 'url', 'digest', 'bytes', 'oversized']) {
      await t.test(`${name}: ${mutation}`, async t => {
        const f = await fixture(t);
        const asset = f.release.assets[index + 1];
        if (mutation === 'missing') f.release.assets.splice(index + 1, 1);
        if (mutation === 'duplicate') f.release.assets.push(asset);
        if (mutation === 'url') asset.browser_download_url = asset.browser_download_url.replace('v1.0.0', 'v1.0.1');
        if (mutation === 'digest') asset.digest = 'sha256:invalid';
        if (mutation === 'bytes') await writeFile(f.bundleFiles[index], 'forged bundle');
        if (mutation === 'oversized') {
          const bytes = 'x'.repeat(524289);
          await writeFile(f.bundleFiles[index], bytes);
          asset.digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
        }
        await writeFile(f.releaseFile, JSON.stringify(f.release));
        const result = f.run();
        assert.equal(result.status, 1, `${mutation}: ${result.stdout}`);
        const commands = await f.commands();
        assert.ok(!commands.some(args => args[0] === 'gh' && args[1] === 'attestation'));
        assert.ok(!commands.some(args => ['npm', 'useradd', 'groupadd'].includes(args[0])));
        assert.deepEqual(await readdir(f.prefix), ['bin']);
      });
    }
  }
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
    [{ FAIL_STEP: 'gh attestation verify /' }, /gh/], [{ FAIL_STEP: 'gh attestation verify oci:' }, /gh/], [{ EXISTING_DOCKER: 'tomecms_postgres-data' }, /fresh/],
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
        await writeFile(f.releaseFile, JSON.stringify({ ...f.release, assets: [{ ...f.release.assets[0], digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` }, ...f.release.assets.slice(1)] }));
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

test('bounded private failure diagnostics survive migration cleanup and redact raw and encoded secrets', async t => {
  const f = await fixture(t);
  const sentinel = 'S3_SENTINEL_sensitive+slash/space and"quote=abcdefgh';
  const result = f.run([], { FAIL_STEP: 'app npm run db:migrate', ORPHAN_MIGRATION: '1', FAIL_PRIVATE_DETAILS: '1', S3_SECRET_ACCESS_KEY: sentinel });
  assert.equal(result.status, 1);
  const files = await readdir(join(f.prefix, 'var/log/tome-cms'));
  assert.equal(files.length, 1);
  assert.match(files[0], /^install-[0-9a-f-]{36}\.json$/);
  const path = join(f.prefix, 'var/log/tome-cms', files[0]);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  const text = await readFile(path, 'utf8');
  assert.ok(Buffer.byteLength(text) <= 256 * 1024);
  const diagnostic = JSON.parse(text);
  assert.equal(diagnostic.failures[0].command, 'docker');
  assert.equal(diagnostic.failures[0].exitCode, 7);
  assert.match(diagnostic.failures[0].args, /app npm run db:migrate/);
  assert.match(diagnostic.failures[0].stdout, /Migration 008_update_rate_limit_actions started/);
  assert.match(diagnostic.failures[0].stderr, /SQLSTATE 23505: duplicate migration record/);
  const values = parseEnv(await readFile(join(f.prefix, 'etc/tome-cms/tome-cms.env'), 'utf8'));
  for (const [key, value] of Object.entries(values)) {
    if (!/PASSWORD|TOKEN|SECRET|KEY|PEPPER|DATABASE_URL/.test(key) || !value) continue;
    for (const secret of [value, encodeURIComponent(value), encodeURI(value), new URLSearchParams({ value }).toString().slice(6), JSON.stringify(value).slice(1, -1), Buffer.from(value).toString('base64'), Buffer.from(value).toString('base64url')]) {
      assert.ok(!JSON.stringify(diagnostic.failures).includes(JSON.stringify(secret).slice(1, -1)), `${key} must be redacted`);
    }
  }
  const output = result.stdout + result.stderr;
  assert.ok(!output.includes(sentinel));
  assert.doesNotMatch(output, /SQLSTATE 23505|Migration 008_update_rate_limit_actions started/);
  assert.ok(output.includes(path));
  const commands = await f.commands();
  const beforeCleanup = commands.find(args => args[0] === 'diagnostics-before-cleanup');
  assert.ok(beforeCleanup?.[1].includes('SQLSTATE 23505'));
  assert.ok(commands.some(args => args[0] === 'docker' && args[1] === 'rm' && args[2] === '--force'));
});

test('installer builds into a clean output directory instead of installing stale ignored build files', async t => {
  const f = await fixture(t);
  await writeFile(join(f.source, 'dist-updater/stale.js'), 'unrelated ignored output');
  const result = f.run([]);
  assert.equal(result.status, 0, result.stderr);
  await assert.rejects(access(join(f.prefix, 'opt/tome-cms/updater/stale.js')));
  assert.equal(await readFile(join(f.prefix, 'opt/tome-cms/updater/updater/main.js'), 'utf8'), 'export {};\n');
});

test('a pull failure precedes account and filesystem mutation', async t => {
  const f = await fixture(t);
  const result = f.run([], { FAIL_STEP: 'docker pull' });
  assert.equal(result.status, 1);
  assert.deepEqual(await readdir(f.prefix), ['bin']);
  assert.doesNotMatch(result.stderr, /Manual recovery:/);
});

test('runtime failures retain every file named by recovery guidance', async t => {
  for (const step of ['config --quiet', 'postgres seaweedfs', 'app npm run db:migrate', '/health/ready', 'systemctl enable']) {
    await t.test(step, async t => {
      const f = await fixture(t);
      const result = f.run([], { FAIL_STEP: step });
      assert.equal(result.status, 1);
      const commands = (await f.commands()).map(args => args.join(' '));
      assert.ok(commands.some(line => line.includes(step)), `failure injection reached ${step}`);
      assert.ok(!commands.some(line => / down |volume rm|image rm/.test(line)));
      for (const path of [
        'opt/tome-cms/compose.managed.yaml',
        'opt/tome-cms/updater/updater/main.js',
        'etc/tome-cms/tome-cms.env',
        'etc/tome-cms/updater.json',
        'etc/systemd/system/tomecms-updater.service',
        'var/lib/tome-cms/updater/image.env',
        'var/lib/tome-cms/updater/installed.json',
      ]) await access(join(f.prefix, path));
      assert.match(result.stderr, /Configuration, credentials, images, volumes and logs retained\. Manual recovery: sudo docker compose -p tomecms -f \/opt\/tome-cms\/compose\.managed\.yaml --env-file \/etc\/tome-cms\/tome-cms\.env --env-file \/var\/lib\/tome-cms\/updater\/image\.env logs --tail 100/);
    });
  }
});
