#!/usr/bin/env bash
set -Eeuo pipefail
# Node handles JSON, atomic files and argv without shell interpolation of release data.
cd -- "${BASH_SOURCE[0]%/*}/.."
exec node --import tsx --input-type=module - "$@" <<'NODE'
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants, closeSync, fchmodSync, fsyncSync, openSync, renameSync, writeFileSync } from 'node:fs';
import { access, chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, rmdir, unlink } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { makeEnvironment, renderEnvironment } from './scripts/bootstrap-core.mjs';
import { compareStableVersions, OFFICIAL_REPOSITORY, OFFICIAL_IMAGE_REPOSITORY, parseStableVersion, parseUpdateManifest, UPDATE_MANIFEST_ASSET, UPDATE_MANIFEST_ATTESTATION_ASSET, UPDATE_IMAGE_ATTESTATION_ASSET } from './src/update/contracts.ts';

const source = process.cwd();
let dryRun = false;
let prefix = '';
let version;
let recoveryReady = false;
let temporary;
let createdGroup = false;
let createdUser = false;
const pendingFiles = [];
const createdFiles = [];
const createdDirectories = [];
const createdDirectorySet = new Set();
const modifiedDirectories = [];
const executables = {};
const diagnosticName = `/var/log/tome-cms/install-${randomUUID()}.json`;
const diagnosticFailures = [];
let diagnosticSaved = false;
let diagnosticSaveFailed = false;
let redactions = [];
const childEnv = { ...process.env };
const inheritedDockerConfig = resolve(process.env.DOCKER_CONFIG || join(process.env.HOME || homedir(), '.docker'));
// Public release access must work without customer GitHub or registry credentials.
for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_HOST', 'GITHUB_HOST', 'GH_ENTERPRISE_HOST', 'GITHUB_ENTERPRISE_HOST', 'GITHUB_API_URL', 'GITHUB_GRAPHQL_URL', 'GITHUB_SERVER_URL', 'GH_REPO', 'GH_CONFIG_DIR', 'XDG_CACHE_HOME', 'HOME', 'DOCKER_CONFIG', 'DOCKER_AUTH_CONFIG', 'REGISTRY_AUTH_FILE', 'DOCKER_CONTENT_TRUST', 'DOCKER_CONTENT_TRUST_SERVER', 'DOCKER_CONTENT_TRUST_REPOSITORY_PASSPHRASE', 'DOCKER_CONTENT_TRUST_ROOT_PASSPHRASE', 'COMPOSE_FILE', 'COMPOSE_PROJECT_NAME', 'COMPOSE_PROFILES']) delete childEnv[key];
delete childEnv.TOME_CMS_APP_IMAGE;
const at = path => prefix ? join(prefix, path) : path;
const destinations = [
  ['/opt/tome-cms', '0755', 'root:root', 'directory'],
  ['/opt/tome-cms/compose.managed.yaml', '0644', 'root:root', 'file'],
  ['/opt/tome-cms/config', '0755', 'root:root', 'directory'],
  ['/opt/tome-cms/config/seaweedfs-s3.json', '0644', 'root:root', 'file'],
  ['/opt/tome-cms/updater', '0755', 'root:root', 'directory'],
  ['/etc/tome-cms', '0750', 'root:tomecms-updater', 'directory'],
  ['/etc/tome-cms/tome-cms.env', '0640', 'root:tomecms-updater', 'file'],
  ['/etc/tome-cms/updater.json', '0644', 'root:root', 'file'],
  ['/var/lib/tome-cms', '0700', 'tomecms-updater:tomecms-updater', 'directory'],
  ['/var/lib/tome-cms/updater', '0700', 'tomecms-updater:tomecms-updater', 'directory'],
  ['/var/lib/tome-cms/updater/docker-public', '0700', 'tomecms-updater:tomecms-updater', 'directory'],
  ['/var/lib/tome-cms/updater/image.env', '0600', 'tomecms-updater:tomecms-updater', 'file'],
  ['/var/lib/tome-cms/updater/installed.json', '0600', 'tomecms-updater:tomecms-updater', 'file'],
  ['/var/backups/tome-cms', '0700', 'tomecms-updater:tomecms-updater', 'directory'],
  ['/var/log/tome-cms', '0700', 'tomecms-updater:tomecms-updater', 'directory'],
  ['/run/tome-cms', '0750', 'tomecms-updater:tomecms-updater', 'directory'],
  ['/etc/systemd/system/tomecms-updater.service', '0644', 'root:root', 'file'],
].map(([path, mode, owner, kind]) => ({ path, mode, owner, kind }));
const config = {
  configVersion: 1, projectName: 'tomecms', composeFile: '/opt/tome-cms/compose.managed.yaml',
  environmentFile: '/etc/tome-cms/tome-cms.env', imageEnvironmentFile: '/var/lib/tome-cms/updater/image.env',
  stateDirectory: '/var/lib/tome-cms/updater', backupDirectory: '/var/backups/tome-cms',
  socketPath: '/run/tome-cms/updater.sock', statusPath: '/run/tome-cms/status.json',
  appHealthUrl: 'http://127.0.0.1:4321/health/ready', minimumFreeBytes: 5368709120,
};
const steps = ['build-updater', 'pull-image', 'create-account', 'install-files', 'start-infrastructure', 'migrate', 'start-app', 'readiness', 'start-updater', 'socket-status'];

function run(name, args, timeout = 30_000, optional = false, raw = false) {
  const result = spawnSync(executables[name], args, { cwd: source, env: childEnv, encoding: 'utf8', timeout, maxBuffer: 512 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error || result.status !== 0) {
    if (optional && !result.error && result.status === 2) return '';
    saveDiagnostic(name, args, result);
    throw new Error(`${name} ${args[0]} failed; inspect the service privately.`);
  }
  return raw ? result.stdout : result.stdout.trim();
}

function cleanupCommand(name, args) {
  const result = spawnSync(executables[name], args, { cwd: source, env: childEnv, encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] });
  return !result.error && result.status === 0;
}

function rememberSecrets(values) {
  const secrets = Object.entries(values).filter(([key, value]) => /PASSWORD|TOKEN|SECRET|KEY|PEPPER|DATABASE_URL/.test(key) && value).map(([, value]) => value);
  const containerDatabase = new URL(values.DATABASE_URL);
  containerDatabase.hostname = 'postgres';
  containerDatabase.port = '5432';
  secrets.push(containerDatabase.href);
  redactions = [...new Set(secrets.flatMap(value => [value, encodeURIComponent(value), encodeURI(value), new URLSearchParams({ value }).toString().slice(6), JSON.stringify(value).slice(1, -1), Buffer.from(value).toString('base64'), Buffer.from(value).toString('base64url')]))];
  redactions.push(...redactions.map(value => value.replace(/%[0-9A-F]{2}/g, encoded => encoded.toLowerCase())));
  redactions.sort((left, right) => right.length - left.length);
}

function privateText(value, limit = 4096) {
  let text = String(value ?? '');
  for (const secret of redactions) text = text.split(secret).join('[redacted]');
  return Buffer.from(text).subarray(0, limit).toString('utf8');
}

function saveDiagnostic(command, args, result) {
  if (!recoveryReady || diagnosticFailures.length >= 4) return;
  diagnosticFailures.push({
    command, args: privateText(args.join(' '), 2048), exitCode: result.status ?? null,
    signal: result.signal ?? null, errorCode: result.error?.code ?? null,
    stdout: privateText(result.stdout), stderr: privateText(result.stderr),
  });
  const pending = `${at(diagnosticName)}.${randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(pending, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    // Four entries, 2 KiB argv and 4 KiB per stream: JSON remains below 256 KiB even after escaping.
    writeFileSync(descriptor, JSON.stringify({ version: 1, failures: diagnosticFailures }) + '\n');
    fchmodSync(descriptor, 0o600);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(pending, at(diagnosticName));
    diagnosticSaved = true;
  } catch {
    diagnosticSaveFailed = true;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

async function safePath(path) {
  const absolute = at(path);
  let current = '/';
  for (const segment of absolute.split('/').filter(Boolean)) {
    current = join(current, segment);
    const info = await lstat(current).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (!info) break;
    if (info.isSymbolicLink()) throw new Error('Managed destination has a symlink ancestor.');
  }
  return absolute;
}

async function unlinkCreated(file) {
  const info = await lstat(file.path).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (info?.isFile() && info.dev === file.dev && info.ino === file.ino) await unlink(file.path);
}

async function writeAtomic(path, content, mode, owner) {
  const target = await safePath(path);
  const pending = `${target}.${randomUUID()}.tmp`;
  const handle = await open(pending, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, Number.parseInt(mode, 8));
  const identity = await handle.stat();
  pendingFiles.push({ path: pending, dev: identity.dev, ino: identity.ino });
  try {
    await handle.writeFile(content);
    await handle.chmod(Number.parseInt(mode, 8));
    await handle.sync();
    run('chown', [owner, pending]);
    await rename(pending, target);
    createdFiles.push({ path: target, dev: identity.dev, ino: identity.ino });
  } finally { await handle.close(); }
}

async function ensureDirectory(path) {
  if (await lstat(path).then(() => true, error => { if (error.code !== 'ENOENT') throw error; return false; })) return;
  await ensureDirectory(dirname(path));
  await mkdir(path, { mode: 0o755 });
  createdDirectories.push(path);
  createdDirectorySet.add(path);
  await chmod(path, 0o755);
}

async function installTree(from, to) {
  const info = await lstat(from);
  if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) throw new Error('Compiled updater must contain only regular files and directories.');
  if (info.isDirectory()) {
    await ensureDirectory(await safePath(to));
    for (const name of await readdir(from)) await installTree(join(from, name), join(to, name));
    return;
  }
  await writeAtomic(to, await readFile(from), '0644', 'root:root');
}

async function readDockerJson(path, maximumBytes) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size > maximumBytes) throw new Error('Invalid Docker client context.');
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error('Invalid Docker client context.');
  }
}

async function preserveDockerConnection() {
  let context = childEnv.DOCKER_CONTEXT;
  if (!context && !childEnv.DOCKER_HOST) {
    const configPath = join(inheritedDockerConfig, 'config.json');
    const info = await lstat(configPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (info) {
      const config = await readDockerJson(configPath, 512 * 1024);
      if (config?.currentContext !== undefined && typeof config.currentContext !== 'string') throw new Error('Invalid Docker client context.');
      context = config?.currentContext;
    }
  }
  if (!context) return;
  delete childEnv.DOCKER_CONTEXT;
  if (context === 'default') {
    delete childEnv.DOCKER_HOST;
    for (const key of ['DOCKER_CERT_PATH', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY']) delete childEnv[key];
    return;
  }
  if (context.length > 256 || context.includes('\0')) throw new Error('Invalid Docker client context.');
  const id = createHash('sha256').update(context).digest('hex');
  const metadataPath = join(inheritedDockerConfig, 'contexts', 'meta', id, 'meta.json');
  const metadata = await readDockerJson(metadataPath, 64 * 1024);
  const endpoint = metadata?.Name === context ? metadata?.Endpoints?.docker : undefined;
  if (typeof endpoint?.Host !== 'string' || !/^(unix|tcp|ssh):\/\//.test(endpoint.Host)) throw new Error('Invalid Docker client context.');
  childEnv.DOCKER_HOST = endpoint.Host;
  for (const key of ['DOCKER_CERT_PATH', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY']) delete childEnv[key];
  const tlsPath = join(inheritedDockerConfig, 'contexts', 'tls', id, 'docker');
  const tls = await lstat(tlsPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (tls) {
    if (!tls.isDirectory()) throw new Error('Invalid Docker client context TLS data.');
    childEnv.DOCKER_CERT_PATH = tlsPath;
    childEnv.DOCKER_TLS = '1';
    if (endpoint.SkipTLSVerify !== true) childEnv.DOCKER_TLS_VERIFY = '1';
  }
}

function requireLocalDockerConnection() {
  const supported = 'unix:///var/run/docker.sock';
  if ((childEnv.DOCKER_HOST || supported) !== supported) {
    throw new Error(`Managed installation requires the local Docker daemon at ${supported}.`);
  }
  childEnv.DOCKER_HOST = supported;
  for (const key of ['DOCKER_CONTEXT', 'DOCKER_CERT_PATH', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY']) delete childEnv[key];
}

function fetchPublic(url) {
  return run('curl', ['--disable', '--fail', '--silent', '--show-error', '--location', '--proto', '=https', '--proto-redir', '=https', '--max-time', '5', '--max-filesize', '524288', url], 10_000, false, true);
}

function runContainer(compose, purpose, args, timeout = 30_000) {
  const name = `tomecms-install-${purpose}-${randomUUID()}`;
  let succeeded = false;
  try {
    const output = run('docker', [...compose, 'run', '--name', name, ...args], timeout);
    succeeded = true;
    return output;
  } finally {
    // A timed-out Docker client can leave its one-shot running. Remove only this invocation's container.
    if (run('docker', ['ps', '-aq', '--filter', `name=^${name}$`])) {
      run('docker', ['rm', '--force', name]);
      if (succeeded) throw new Error('Installer one-shot outlived its client; manual recovery is required.');
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  while (args.length) {
    const arg = args.shift();
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--version' && !version) version = args.shift();
    else if (arg === '--root-prefix' && !prefix && args[0]) prefix = args.shift();
    else throw new Error('Use --version X.Y.Z [--dry-run]; --root-prefix is a stub-only test boundary.');
  }
  version = parseStableVersion(version).raw;
  if (compareStableVersions(version, '1.0.0') < 0) throw new Error('Managed installation requires a stable release from 1.0.0 onward.');
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node 22+ is required.');
  if (prefix && (!isAbsolute(prefix) || resolve(prefix) !== prefix || prefix === '/')) throw new Error('Invalid root prefix.');
  for (const name of ['uname', 'id', 'getent', 'groupadd', 'groupdel', 'useradd', 'userdel', 'chown', 'git', 'docker', 'gh', 'npm', 'curl', 'systemctl']) {
    const candidates = prefix ? [join(prefix, 'bin', name)] : (process.env.PATH || '').split(':').filter(Boolean).map(path => join(path, name));
    for (const candidate of candidates) {
      if (await access(candidate, constants.X_OK).then(() => true, () => false)) {
        // Prefix mode can only invoke self-contained doubles inside its root, never host executables.
        if (prefix && (await lstat(candidate)).isSymbolicLink()) throw new Error('Root-prefix tools must be stub executables, not symlinks.');
        executables[name] = candidate;
        break;
      }
    }
    if (!executables[name]) throw new Error(`Missing '${name}'.`);
  }
  if (run('uname', ['-s']) !== 'Linux') throw new Error('Managed VPS installation requires Linux.');
  const architecture = run('uname', ['-m']);
  const platform = ({ x86_64: 'linux/amd64', aarch64: 'linux/arm64', arm64: 'linux/arm64' })[architecture];
  if (!platform) throw new Error('Unsupported host architecture.');
  if (!dryRun && (prefix ? run('id', ['-u']) : String(process.getuid?.())) !== '0') throw new Error('Run installation as root using sudo.');
  if (!prefix) {
    await access('/usr/bin/node', constants.X_OK).catch(() => { throw new Error('systemd requires Node 22+ installed at /usr/bin/node.'); });
    const nodeVersion = spawnSync('/usr/bin/node', ['--version'], { encoding: 'utf8' });
    if (nodeVersion.status !== 0 || Number(nodeVersion.stdout.match(/^v(\d+)/)?.[1]) < 22) throw new Error('systemd requires Node 22+ at /usr/bin/node.');
  }
  const packageVersion = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')).version;
  if (packageVersion !== version) throw new Error('Requested version must equal package.json.');
  if (run('git', ['describe', '--tags', '--exact-match', 'HEAD']) !== `v${version}`) throw new Error('Checkout must match the exact stable release tag.');
  if (run('git', ['status', '--porcelain', '--untracked-files=normal'])) throw new Error('Managed installer requires a clean release checkout.');
  const commit = run('git', ['rev-parse', 'HEAD']);
  if (!/^[0-9a-f]{40}$/.test(commit) || run('git', ['rev-parse', `v${version}^{commit}`]) !== commit) throw new Error('Checkout commit does not match tag.');
  for (const target of destinations) {
    const path = await safePath(target.path);
    const info = await lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (info && (target.kind !== 'directory' || !info.isDirectory() || (await readdir(path)).length)) throw new Error('Managed installation requires fresh empty destinations; existing files are retained.');
  }
  await preserveDockerConnection();
  requireLocalDockerConnection();
  temporary = await mkdtemp(join(prefix || tmpdir(), 'tomecms-install-'));
  childEnv.HOME = join(temporary, 'home');
  childEnv.DOCKER_CONFIG = join(temporary, 'docker-config');
  childEnv.GH_CONFIG_DIR = join(temporary, 'gh-config');
  childEnv.XDG_CACHE_HOME = join(temporary, 'gh-cache');
  childEnv.GH_PROMPT_DISABLED = '1';
  for (const directory of [childEnv.HOME, childEnv.DOCKER_CONFIG, childEnv.GH_CONFIG_DIR, childEnv.XDG_CACHE_HOME]) {
    await mkdir(directory, { mode: 0o700 });
    await chmod(directory, 0o700);
  }
  run('docker', ['info']);
  run('docker', ['compose', 'version']);
  run('gh', ['version']);
  if (Number(run('systemctl', ['--version']).match(/^systemd (\d+)/)?.[1] || 0) < 235) throw new Error('systemd 235+ is required.');
  if (!run('getent', ['group', 'docker'], 30_000, true)) throw new Error('Docker group is required.');
  if (run('getent', ['passwd', 'tomecms-updater'], 30_000, true) || run('getent', ['group', 'tomecms-updater'], 30_000, true)) throw new Error('Managed service account already exists; use manual recovery.');
  if (run('docker', ['ps', '-aq', '--filter', 'label=com.docker.compose.project=tomecms']) ||
      run('docker', ['volume', 'ls', '-q', '--filter', 'name=^tomecms_(postgres|seaweedfs)-data$'])) throw new Error('Managed installation requires fresh Docker project and volumes.');
  const publicRepo = JSON.parse(fetchPublic(`https://api.github.com/repos/${OFFICIAL_REPOSITORY}`));
  if (publicRepo.full_name !== OFFICIAL_REPOSITORY || publicRepo.private !== false || publicRepo.visibility !== 'public') throw new Error('Official repository must be public.');
  const release = JSON.parse(fetchPublic(`https://api.github.com/repos/${OFFICIAL_REPOSITORY}/releases/tags/v${version}`));
  const releaseUrl = `https://github.com/${OFFICIAL_REPOSITORY}/releases/tag/v${version}`;
  const published = Date.parse(release.published_at);
  if (release.tag_name !== `v${version}` || release.draft !== false || release.prerelease !== false || release.immutable !== true ||
      release.html_url !== releaseUrl || !Number.isFinite(published) || published > Date.now() || !Array.isArray(release.assets)) throw new Error('Invalid or non-immutable official release.');
  const assets = [UPDATE_MANIFEST_ASSET, UPDATE_MANIFEST_ATTESTATION_ASSET, UPDATE_IMAGE_ATTESTATION_ASSET].map(name => {
    const matches = release.assets.filter(asset => asset?.name === name);
    const url = `https://github.com/${OFFICIAL_REPOSITORY}/releases/download/v${version}/${name}`;
    if (matches.length !== 1 || matches[0].browser_download_url !== url || typeof matches[0].digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(matches[0].digest)) throw new Error('Invalid official release asset.');
    return { name, url, digest: matches[0].digest };
  });
  for (const asset of assets) {
    asset.bytes = fetchPublic(asset.url);
    if (Buffer.byteLength(asset.bytes) > 512 * 1024 || `sha256:${createHash('sha256').update(asset.bytes).digest('hex')}` !== asset.digest) throw new Error('Release asset digest or size mismatch.');
  }
  const bytes = assets[0].bytes;
  const manifest = parseUpdateManifest(JSON.parse(bytes));
  if (manifest.version !== version || manifest.source.commit !== commit || !manifest.image.platforms.includes(platform) ||
      Date.parse(manifest.releasedAt) > Date.now()) throw new Error('Manifest version, source commit or platform mismatch.');
  const compatibility = manifest.compatibility;
  if ([compatibility.composeContract, compatibility.environmentContract, compatibility.updaterProtocol].some(value => value !== 1) ||
      compareStableVersions(compatibility.minimumUpdaterVersion, '1.0.0') > 0) throw new Error('Manual updater contract upgrade is required.');
  await access(join(source, 'src/server/db/migrations', `${compatibility.targetMigration}.ts`)).catch(() => { throw new Error('Target migration is not shipped in this checkout.'); });
  for (const asset of assets) {
    const handle = await open(join(temporary, asset.name), 'wx', 0o600);
    try { await handle.writeFile(asset.bytes); await handle.chmod(0o600); } finally { await handle.close(); }
  }
  const policy = ['-R', OFFICIAL_REPOSITORY, '--signer-workflow', `${OFFICIAL_REPOSITORY}/.github/workflows/release.yml`, '--source-ref', `refs/tags/v${version}`, '--source-digest', commit, '--deny-self-hosted-runners'];
  run('gh', ['attestation', 'verify', join(temporary, UPDATE_MANIFEST_ASSET), '--bundle', join(temporary, UPDATE_MANIFEST_ATTESTATION_ASSET), ...policy], 300_000);
  const image = `${OFFICIAL_IMAGE_REPOSITORY}@${manifest.image.digest}`;
  run('gh', ['attestation', 'verify', `oci://${image}`, '--bundle', join(temporary, UPDATE_IMAGE_ATTESTATION_ASSET), ...policy], 300_000);
  const inputKeys = ['POSTGRES_PASSWORD', 'POSTGRES_PORT', 'S3_PORT', 'APP_PORT', 'DATABASE_URL', 'DATABASE_POOL_MAX', 'DATABASE_CONNECTION_TIMEOUT_MS', 'DATABASE_QUERY_TIMEOUT_MS',
    'TOME_CMS_PUBLIC_URL', 'TOME_CMS_INSTALL_TOKEN', 'TOME_CMS_CONTEXT_SECRET', 'TOME_CMS_RECOVERY_PEPPER', 'TOME_CMS_FRONTEND_MODE', 'BETTER_AUTH_SECRET',
    'S3_ENDPOINT', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_BUCKET', 'S3_FORCE_PATH_STYLE', 'MEDIA_PUBLIC_URL'];
  const input = Object.fromEntries(Object.entries(process.env).filter(([key]) => inputKeys.includes(key)));
  const values = makeEnvironment(input, true, {}, true);
  if (values.APP_PORT && values.APP_PORT !== '4321') throw new Error('Managed contract requires APP_PORT=4321.');
  // Validate every value before any install mutation, without printing secrets.
  renderEnvironment(values);
  rememberSecrets(values);
  if (dryRun) {
    console.log(JSON.stringify({ version, platform, image, user: 'tomecms-updater', group: 'tomecms-updater', destinations, steps }));
    return;
  }
  const compiled = join(temporary, 'dist-updater');
  run('npm', ['run', 'build:updater', '--', '--outDir', compiled], 300_000);
  run('docker', ['pull', image], 900_000);
  const inspection = JSON.parse(run('docker', ['image', 'inspect', image]));
  const actual = inspection?.[0];
  if (inspection.length !== 1 || !actual?.RepoDigests?.includes(image) || `${actual.Os}/${actual.Architecture}` !== platform ||
      actual.Config?.Labels?.['org.opencontainers.image.version'] !== version || actual.Config?.Labels?.['org.opencontainers.image.revision'] !== commit) throw new Error('Pulled image identity or platform mismatch.');
  const inventory = JSON.parse(runContainer([], 'inventory', ['--rm', '--pull', 'never', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--entrypoint', 'node', image,
    '--import', 'tsx', '--input-type=module', '-e', "import { migrations } from '/app/src/server/db/migrator.ts'; process.stdout.write(JSON.stringify(Object.keys(migrations)));" ]));
  if (!Array.isArray(inventory) || inventory.at(-1) !== compatibility.targetMigration) throw new Error('Target image migration inventory mismatch.');
  run('groupadd', ['--system', 'tomecms-updater']);
  createdGroup = true;
  run('useradd', ['--system', '--gid', 'tomecms-updater', '--groups', 'docker', '--home-dir', '/nonexistent', '--no-create-home', '--shell', '/usr/sbin/nologin', 'tomecms-updater']);
  createdUser = true;
  const gid = run('id', ['-g', 'tomecms-updater']);
  if (!/^[1-9]\d*$/.test(gid) || !Number.isSafeInteger(Number(gid))) throw new Error('Invalid updater group ID.');
  values.TOME_CMS_UPDATER_GID = gid;
  for (const target of destinations.filter(item => item.kind === 'directory')) {
    const path = await safePath(target.path);
    await ensureDirectory(path);
    if (!createdDirectorySet.has(path)) {
      const info = await lstat(path);
      modifiedDirectories.push({ path, mode: info.mode & 0o7777, uid: info.uid, gid: info.gid });
    }
    await chmod(path, Number.parseInt(target.mode, 8));
    run('chown', [target.owner, path]);
  }
  await writeAtomic(config.environmentFile, renderEnvironment(values), '0640', 'root:tomecms-updater');
  await installTree(compiled, '/opt/tome-cms/updater');
  await writeAtomic('/opt/tome-cms/updater/package.json', '{"type":"module"}\n', '0644', 'root:root');
  for (const [path, from] of [[config.composeFile, 'compose.managed.yaml'], ['/opt/tome-cms/config/seaweedfs-s3.json', 'config/seaweedfs-s3.json'], ['/etc/systemd/system/tomecms-updater.service', 'config/systemd/tomecms-updater.service']]) {
    await ensureDirectory(dirname(at(path)));
    await writeAtomic(path, await readFile(join(source, from)), '0644', 'root:root');
  }
  await writeAtomic('/etc/tome-cms/updater.json', `${JSON.stringify(config, null, 2)}\n`, '0644', 'root:root');
  await writeAtomic(config.imageEnvironmentFile, `TOME_CMS_APP_IMAGE='${image}'\n`, '0600', 'tomecms-updater:tomecms-updater');
  await writeAtomic(`${config.stateDirectory}/installed.json`, `${JSON.stringify({ version, imageDigest: manifest.image.digest, composeContract: 1, environmentContract: 1, updaterProtocol: 1, installedAt: new Date().toISOString() })}\n`, '0600', 'tomecms-updater:tomecms-updater');
  for (const path of [config.composeFile, config.environmentFile, config.imageEnvironmentFile, `${config.stateDirectory}/installed.json`, '/etc/tome-cms/updater.json', '/etc/systemd/system/tomecms-updater.service', '/opt/tome-cms/updater/updater/main.js']) await access(at(path));
  recoveryReady = true;
  const compose = ['compose', '-p', 'tomecms', '-f', at(config.composeFile), '--env-file', at(config.environmentFile), '--env-file', at(config.imageEnvironmentFile)];
  // Ambient shell settings must not override the files the updater will use on subsequent runs.
  for (const key of Object.keys(values)) delete childEnv[key];
  run('docker', [...compose, 'config', '--quiet']);
  run('docker', [...compose, 'up', '-d', '--wait', '--wait-timeout', '90', 'postgres', 'seaweedfs'], 120_000);
  runContainer(compose, 'migration', ['--rm', '--no-deps', '--pull', 'never', 'app', 'npm', 'run', 'db:migrate'], 900_000);
  run('docker', [...compose, 'up', '-d', '--wait', '--wait-timeout', '90', '--no-deps', '--pull', 'never', 'app'], 120_000);
  run('curl', ['--disable', '--fail', '--silent', '--show-error', '--max-time', '5', config.appHealthUrl], 10_000);
  run('systemctl', ['daemon-reload']);
  run('systemctl', ['enable', '--now', 'tomecms-updater.service']);
  const status = JSON.parse(run('curl', ['--disable', '--fail', '--silent', '--show-error', '--retry', '20', '--retry-all-errors', '--retry-delay', '1', '--retry-max-time', '30', '--max-time', '2', '--unix-socket', at(config.socketPath), 'http://localhost/v1/status'], 35_000));
  if (status.managed !== true || status.protocolVersion !== 1 || status.updaterVersion !== '1.0.0' || status.installed?.version !== version || status.installed?.imageDigest !== manifest.image.digest) throw new Error('Updater socket status does not match installed release.');
  const socket = await lstat(at(config.socketPath));
  if ((!prefix && !socket.isSocket()) || socket.isSymbolicLink() || (socket.mode & 0o777) !== 0o660) throw new Error('Updater socket type or permissions are invalid.');
  console.log(`Installer: ${values.TOME_CMS_PUBLIC_URL}/install\nInstallation token: sudo grep '^TOME_CMS_INSTALL_TOKEN=' /etc/tome-cms/tome-cms.env\nCurrent version: ${version}\nBackups: /var/backups/tome-cms`);
}

try { await main(); }
catch (error) {
  if (recoveryReady && !diagnosticFailures.length) saveDiagnostic('installer', [], { stderr: error instanceof Error ? error.message : 'Managed installation failed.' });
  console.error(recoveryReady ? 'Managed installation failed; inspect the private diagnostics.' : privateText(error instanceof Error ? error.message : 'Managed installation failed.'));
  if (recoveryReady) {
    console.error('Configuration, credentials, images, volumes and logs retained. Manual recovery: sudo docker compose -p tomecms -f /opt/tome-cms/compose.managed.yaml --env-file /etc/tome-cms/tome-cms.env --env-file /var/lib/tome-cms/updater/image.env logs --tail 100');
    if (diagnosticSaved) console.error(`Private installer diagnostics: ${at(diagnosticName)}`);
    if (diagnosticSaveFailed) console.error('Private installer diagnostics could not be fully saved.');
  }
  process.exitCode = 1;
} finally {
  for (const file of pendingFiles) await unlinkCreated(file).catch(() => {});
  if (!recoveryReady) {
    for (const file of createdFiles.reverse()) await unlinkCreated(file).catch(() => {});
    for (const directory of modifiedDirectories.reverse()) {
      if (!cleanupCommand('chown', [`${directory.uid}:${directory.gid}`, directory.path])) console.error(`Installer rollback could not restore ownership for ${directory.path}.`);
      await chmod(directory.path, directory.mode).catch(() => console.error(`Installer rollback could not restore permissions for ${directory.path}.`));
    }
    for (const path of createdDirectories.reverse()) await rmdir(path).catch(() => {});
    const userRemoved = !createdUser || cleanupCommand('userdel', ['tomecms-updater']);
    if (!userRemoved) console.error('Installer rollback could not remove the tomecms-updater user.');
    if (createdGroup && (!userRemoved || !cleanupCommand('groupdel', ['tomecms-updater']))) console.error('Installer rollback could not remove the tomecms-updater group.');
  }
  if (temporary) {
    // This exact directory was exclusively created above and contains only the fetched manifest/build output.
    await rm(temporary, { recursive: true, force: true });
  }
}
NODE
