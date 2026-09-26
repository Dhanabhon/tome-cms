import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import { createServer, isIP } from 'node:net';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const secrets = ['POSTGRES_PASSWORD', 'S3_SECRET_ACCESS_KEY', 'TOME_CMS_INSTALL_TOKEN', 'BETTER_AUTH_SECRET', 'TOME_CMS_CONTEXT_SECRET', 'TOME_CMS_RECOVERY_PEPPER'];
const required = [...secrets, 'DATABASE_URL', 'TOME_CMS_PUBLIC_URL', 'S3_ENDPOINT', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_BUCKET', 'S3_FORCE_PATH_STYLE', 'MEDIA_PUBLIC_URL'];
const optional = ['DATABASE_POOL_MAX', 'DATABASE_CONNECTION_TIMEOUT_MS', 'DATABASE_QUERY_TIMEOUT_MS'];

export function parseOptions(args) {
  const options = { production: false, force: false };
  const flags = { '--production': 'production', '--force': 'force' };
  for (const arg of args) {
    if (!Object.hasOwn(flags, arg)) throw new Error(`Unknown option: ${arg}`);
    options[flags[arg]] = true;
  }
  return options;
}

function localUrls(values) {
  return {
    DATABASE_URL: `postgresql://tomecms:${values.POSTGRES_PASSWORD}@127.0.0.1:${values.POSTGRES_PORT || 5432}/tomecms`,
    TOME_CMS_PUBLIC_URL: `http://localhost:${values.APP_PORT || 4321}`,
    S3_ENDPOINT: `http://127.0.0.1:${values.S3_PORT || values.MINIO_PORT || 9000}`,
  };
}

function isPublicHost(host) {
  // ponytail: conservative literal/suffix policy, no DNS; add resolution checks if actual reachability must be verified.
  if (isIP(host) === 4) {
    const [a, b, c] = host.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(host) === 6) {
    const [first, second] = host.split(':').map(part => Number.parseInt(part || '0', 16));
    // Only 2000::/3 global unicast, excluding special 2001::/23, documentation, and 6to4 prefixes.
    return first >= 0x2000 && first <= 0x3fff &&
      !(first === 0x2001 && (second < 0x200 || second === 0xdb8)) &&
      first !== 0x2002 && !(first === 0x3fff && second < 0x1000);
  }
  const localSuffixes = ['local', 'localhost', 'internal', 'localdomain', 'lan', 'home.arpa', 'test', 'invalid', 'example', 'onion', 'alt'];
  return host.length <= 253 && host.includes('.') &&
    host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) &&
    !localSuffixes.some(suffix => host === suffix || host.endsWith(`.${suffix}`));
}

export function makeEnvironment(input, production, existing = {}, managed = false) {
  if (managed && !production) throw new Error('Managed updates require production.');
  const values = { ...existing, ...input };
  values.TOME_CMS_UPDATE_MODE = managed ? 'managed' : 'check-only';
  values.TOME_CMS_UPDATER_SOCKET = '/run/tome-cms/updater.sock';
  if (!values.S3_PORT && values.MINIO_PORT) values.S3_PORT = values.MINIO_PORT;
  for (const key of ['MINIO_PORT', 'MINIO_CONSOLE_PORT', 'MINIO_LICENSE_FILE']) delete values[key];
  for (const key of secrets) values[key] ||= randomBytes(32).toString('base64url');
  if (!/^[A-Za-z0-9_-]+$/.test(values.POSTGRES_PASSWORD)) throw new Error('POSTGRES_PASSWORD must use URL-safe letters, digits, underscores or hyphens.');
  const previousDefaults = localUrls(existing);
  const defaults = {
    ...localUrls(values), DATABASE_POOL_MAX: '10', DATABASE_CONNECTION_TIMEOUT_MS: '5000', DATABASE_QUERY_TIMEOUT_MS: '30000', S3_REGION: 'us-east-1',
    S3_ACCESS_KEY_ID: 'tomecms', S3_BUCKET: 'tomecms-media', S3_FORCE_PATH_STYLE: 'true', TOME_CMS_FRONTEND_MODE: 'bundled',
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (!values[key] || (!Object.hasOwn(input, key) && existing[key] === previousDefaults[key])) values[key] = value;
  }
  const previousMedia = existing.S3_ENDPOINT && `${existing.S3_ENDPOINT.replace(/\/$/, '')}/${existing.S3_BUCKET}/`;
  if (!values.MEDIA_PUBLIC_URL || (!Object.hasOwn(input, 'MEDIA_PUBLIC_URL') && existing.MEDIA_PUBLIC_URL === previousMedia)) {
    values.MEDIA_PUBLIC_URL = `${values.S3_ENDPOINT.replace(/\/$/, '')}/${values.S3_BUCKET}/`;
  }
  values.NODE_ENV = production ? 'production' : 'development';
  for (const key of ['TOME_CMS_PUBLIC_URL', 'S3_ENDPOINT', 'MEDIA_PUBLIC_URL']) {
    let url;
    try { url = new URL(values[key]); } catch { throw new Error(`${key} must be a valid URL.`); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (production && url.protocol !== 'https:')) {
      throw new Error(`${key} requires ${production ? 'HTTPS' : 'HTTP(S)'} without credentials; configure TLS separately.`);
    }
    if (key === 'TOME_CMS_PUBLIC_URL' && (url.pathname !== '/' || url.search || url.hash)) {
      throw new Error('TOME_CMS_PUBLIC_URL must be an origin without a path, query, or fragment.');
    }
    if (key === 'TOME_CMS_PUBLIC_URL') values[key] = url.origin;
    const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (production && !isPublicHost(host)) {
      throw new Error(`${key} requires a browser-reachable public host; local or special-use address forms are not allowed.`);
    }
  }
  if (production && values.DATABASE_URL !== localUrls(values).DATABASE_URL) {
    throw new Error('Production DATABASE_URL must target the bundled Compose database.');
  }
  return values;
}

export function renderEnvironment(values) {
  for (const key of required) if (!values[key]) throw new Error(`${key} is required.`);
  for (const key of secrets) if (values[key].length < (key === 'S3_SECRET_ACCESS_KEY' || key === 'POSTGRES_PASSWORD' ? 8 : 32)) throw new Error(`${key} is too short.`);
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(values.S3_BUCKET)) throw new Error('S3_BUCKET is invalid.');
  return Object.entries(values).map(([key, value]) => {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error('Invalid environment key.');
    if (typeof value !== 'string' || /['\r\n\0]/.test(value)) throw new Error(`Unsupported characters in ${key}.`);
    return `${key}='${value}'`;
  }).join('\n') + '\n';
}

export async function writeEnvironment(path, content, force = false) {
  if (force) {
    const existing = await lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (existing && !existing.isFile()) throw new Error('Environment must be a regular file, not a symlink.');
  }
  const target = force ? `${path}.${randomBytes(8).toString('hex')}.tmp` : path;
  let file;
  try {
    file = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_EXCL, 0o600);
  } catch (error) {
    if (!force && error.code === 'EEXIST') return false;
    throw error;
  }
  try {
    await file.writeFile(content);
    await file.sync();
    if (force) await rename(target, path);
  } finally {
    await file.close();
    if (force) await unlink(target).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  return true;
}

/** npm is a .cmd shim on Windows, which Node starts only through a shell. The command is fixed, so nothing is interpolated into it. */
export function migrateCommand(platform = process.platform) {
  return platform === 'win32'
    ? { args: [], command: 'npm.cmd run db:migrate', shell: true }
    : { args: ['run', 'db:migrate'], command: 'npm', shell: false };
}

/** Whether a file's mode keeps it to its owner. Windows has no such bits and reports 0o666 for any writable file, so there the mode says nothing. */
export function isPrivateMode(mode, platform = process.platform) {
  return platform === 'win32' || (mode & 0o077) === 0;
}

function run(command, args, env = process.env, shell = false) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', shell, stdio: ['ignore', 'pipe', 'pipe'] });
  // Child errors can include resolved Compose secrets or database URLs.
  if (result.error || result.status !== 0) throw new Error(`${[command, ...args.slice(0, 1)].join(' ')} failed; inspect the service privately.`);
  return result.stdout;
}

async function verifyPorts(values, compose, env) {
  const containers = run('docker', [...compose, 'ps', '--format', 'json'], env).trim();
  const owned = containers ? (containers.startsWith('[') ? JSON.parse(containers) : containers.split('\n').map(line => JSON.parse(line))) : [];
  const ports = ['POSTGRES_PORT', 'S3_PORT', 'APP_PORT'].map((key, i) => Number(values[key] || [5432, 9000, 4321][i]));
  if (new Set(ports).size !== ports.length || ports.some(port => !Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('Ports must be distinct integers from 1 to 65535.');
  for (const port of ports) {
    if (owned.some(container => container.Publishers?.some(publisher => publisher.PublishedPort === port))) continue;
    await new Promise((done, reject) => {
      const server = createServer();
      server.once('error', () => reject(new Error(`Port ${port} is unavailable.`)));
      server.listen(port, '127.0.0.1', () => server.close(done));
    });
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node 22 or newer is required.');
  const path = resolve(root, '.env.local');
  let existing = {};
  let existingFile = false;
  try {
    const details = await lstat(path);
    existingFile = true;
    if (!details.isFile() || details.isSymbolicLink()) throw new Error('Environment must be a regular file, not a symlink.');
    if (!isPrivateMode(details.mode) && !options.force) throw new Error('Set .env.local permissions to 0600 before continuing.');
    existing = parseEnv(await readFile(path, 'utf8'));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const overrides = Object.fromEntries(Object.entries(process.env).filter(([key]) => required.includes(key) || optional.includes(key) || /^(POSTGRES_PORT|S3_PORT|APP_PORT)$/.test(key)));
  const values = makeEnvironment(overrides, options.production, existing);
  if (existingFile && !options.force && Object.entries(values).some(([key, value]) => existing[key] !== value)) {
    throw new Error('Existing .env.local needs updates; rerun with --force to merge values while preserving secrets.');
  }
  const rendered = renderEnvironment(values);
  run('docker', ['info']);
  run('docker', ['compose', 'version']);
  const env = { ...process.env, ...values };
  // Before creation, config/ps use the checked values through the child environment.
  const preflight = ['compose', '-f', 'compose.yaml'];
  run('docker', [...preflight, 'config', '--quiet'], env);
  await verifyPorts(values, preflight, env);
  if ((!existingFile || options.force) && !await writeEnvironment(path, rendered, options.force)) {
    throw new Error('Environment file appeared during bootstrap; rerun to verify it before startup.');
  }
  const compose = ['compose', '-f', 'compose.yaml', '--env-file', '.env.local'];
  if (options.production) run('docker', [...compose, 'pull', 'postgres', 'seaweedfs'], env);
  console.log('Starting PostgreSQL and SeaweedFS…');
  run('docker', [...compose, 'up', '-d', '--wait', 'postgres', 'seaweedfs'], env);
  console.log('Applying database migrations…');
  if (options.production) {
    run('docker', [...compose, '--profile', 'production', 'build', 'app'], env);
    run('docker', [...compose, '--profile', 'production', 'run', '--rm', '--no-deps', 'app', 'npm', 'run', 'db:migrate'], env);
    run('docker', [...compose, '--profile', 'production', 'up', '-d', '--wait', '--no-deps', 'app'], env);
  } else {
    const migrate = migrateCommand();
    run(migrate.command, migrate.args, env, migrate.shell);
  }
  console.log(`Installer: ${values.TOME_CMS_PUBLIC_URL.replace(/\/$/, '')}/install`);
  console.log(`Installation token: ${values.TOME_CMS_INSTALL_TOKEN}`);
  if (!options.production) console.log('Start the application with npm run dev.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
