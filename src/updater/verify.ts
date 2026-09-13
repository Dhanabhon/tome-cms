import { createHash, timingSafeEqual } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rm, statfs, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  compareStableVersions,
  OFFICIAL_IMAGE_REPOSITORY,
  OFFICIAL_REPOSITORY,
  parseStableVersion,
  parseUpdateManifest,
  UPDATE_IMAGE_ATTESTATION_ASSET,
  UPDATE_MANIFEST_ASSET,
  UPDATE_MANIFEST_ATTESTATION_ASSET,
  type UpdateManifest,
} from '../update/contracts.js';
import type { UpdaterConfig } from './config.js';
import { runCommand, type CommandResult } from './process.js';
import type { InstalledState } from './state.js';

const githubApiVersion = '2022-11-28';
const responseLimit = 512 * 1024;
const requestTimeoutMs = 5_000;
const commandTimeoutMs = 30_000;
const attestationTimeoutMs = 5 * 60_000;
const releaseWorkflow = 'Dhanabhon/tome-cms/.github/workflows/release.yml';
const githubEnvironmentKeys = [
  'GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN',
  'GH_HOST', 'GITHUB_HOST', 'GH_ENTERPRISE_HOST', 'GITHUB_ENTERPRISE_HOST',
  'GITHUB_API_URL', 'GITHUB_GRAPHQL_URL', 'GITHUB_SERVER_URL', 'GH_REPO',
] as const;

export interface VerifiedRelease {
  manifest: UpdateManifest;
  manifestPath: string;
  imageReference: string;
}

export interface VerifyDependencies {
  fetcher: typeof fetch;
  runCommand: typeof import('./process.js').runCommand;
  statfs: typeof import('node:fs/promises').statfs;
  now: () => Date;
  hostPlatform?: () => string;
}

const defaults: VerifyDependencies = {
  fetcher: fetch,
  runCommand,
  statfs,
  now: () => new Date(),
  hostPlatform: currentPlatform,
};

export async function verifyTargetRelease(input: {
  version: string;
  installed: InstalledState;
  updaterVersion: string;
  config: UpdaterConfig;
  dependencies?: VerifyDependencies;
}): Promise<VerifiedRelease> {
  const version = parseStableVersion(input.version).raw;
  const dependencies = { ...defaults, ...input.dependencies };
  const tag = `v${version}`;
  const releaseUrl = `https://api.github.com/repos/${OFFICIAL_REPOSITORY}/releases/tags/${tag}`;
  const release = releaseDetails(await fetchJson(dependencies.fetcher, releaseUrl), version, dependencies.now());
  const [manifestBytes, manifestBundleBytes, imageBundleBytes] = await Promise.all([
    fetchBytes(dependencies.fetcher, release.manifest.url),
    fetchBytes(dependencies.fetcher, release.manifestBundle.url),
    fetchBytes(dependencies.fetcher, release.imageBundle.url),
  ]);
  verifyDigest(manifestBytes, release.manifest.digest);
  verifyDigest(manifestBundleBytes, release.manifestBundle.digest);
  verifyDigest(imageBundleBytes, release.imageBundle.digest);
  const manifest = parseManifestBytes(manifestBytes);
  if (manifest.version !== version) throw new Error('Release version does not match manifest');

  const directory = await mkdtemp(join(tmpdir(), 'tomecms-update-'));
  const manifestPath = join(directory, UPDATE_MANIFEST_ASSET);
  const manifestBundlePath = join(directory, UPDATE_MANIFEST_ATTESTATION_ASSET);
  const imageBundlePath = join(directory, UPDATE_IMAGE_ATTESTATION_ASSET);
  try {
    await writeFile(manifestPath, manifestBytes, { flag: 'wx', mode: 0o600 });
    await writeFile(manifestBundlePath, manifestBundleBytes, { flag: 'wx', mode: 0o600 });
    await writeFile(imageBundlePath, imageBundleBytes, { flag: 'wx', mode: 0o600 });

    const policy = [
      '-R', OFFICIAL_REPOSITORY,
      '--signer-workflow', releaseWorkflow,
      '--source-ref', `refs/tags/${tag}`,
      '--source-digest', manifest.source.commit,
      '--deny-self-hosted-runners',
    ] as const;
    const imageReference = await withIsolatedGhEnvironment(input.config.stateDirectory, async (environment) => {
      await successfulCommand(dependencies, 'gh', [
        'attestation', 'verify', manifestPath, '--bundle', manifestBundlePath, ...policy,
      ], attestationTimeoutMs, 'Manifest attestation verification failed', environment);
      const imageReference = `${OFFICIAL_IMAGE_REPOSITORY}@${manifest.image.digest}`;
      await successfulCommand(dependencies, 'gh', [
        'attestation', 'verify', `oci://${imageReference}`, '--bundle', imageBundlePath, ...policy,
      ], attestationTimeoutMs, 'Image attestation verification failed', environment);
      return imageReference;
    });
    assertCompatibility(input.installed, manifest, input.updaterVersion);

    await runPreflight({
      installed: input.installed,
      target: manifest,
      updaterVersion: input.updaterVersion,
      config: input.config,
      dependencies,
    });
    return { manifest, manifestPath, imageReference };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function runPreflight(input: {
  installed: InstalledState;
  target: UpdateManifest;
  updaterVersion: string;
  config: UpdaterConfig;
  dependencies?: VerifyDependencies;
}): Promise<void> {
  const dependencies = { ...defaults, ...input.dependencies };
  assertCompatibility(input.installed, input.target, input.updaterVersion);
  await verifyManagedFiles(input.config);
  await verifyConfiguredImage(input.config, input.installed.imageDigest);

  await successfulCommand(dependencies, 'docker', ['version'], commandTimeoutMs, 'Docker Engine preflight failed');
  await successfulCommand(dependencies, 'docker', ['compose', 'version'], commandTimeoutMs, 'Docker Compose preflight failed');
  await withIsolatedGhEnvironment(input.config.stateDirectory, (environment) =>
    successfulCommand(dependencies, 'gh', ['version'], commandTimeoutMs, 'GitHub CLI preflight failed', environment));

  const compose = [
    'compose', '-p', input.config.projectName, '-f', input.config.composeFile,
    '--env-file', input.config.environmentFile,
    '--env-file', input.config.imageEnvironmentFile,
  ] as const;
  const health = await successfulCommand(dependencies, 'docker', [
    ...compose, 'ps', '--format', 'json', 'app', 'postgres', 'seaweedfs',
  ], commandTimeoutMs, 'Compose service preflight failed');
  verifyComposeHealth(health.stdout);

  const readiness = await dependencies.fetcher(input.config.appHealthUrl, {
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  if (!readiness.ok) throw new Error('Application health preflight failed');

  const filesystem = await dependencies.statfs(input.config.backupDirectory);
  const availableBytes = filesystem.bsize * filesystem.bavail;
  if (!Number.isSafeInteger(availableBytes) || availableBytes < input.config.minimumFreeBytes) {
    throw new Error('Insufficient backup disk space');
  }

  const platform = dependencies.hostPlatform?.() ?? currentPlatform();
  if (!input.target.image.platforms.includes(platform as 'linux/amd64' | 'linux/arm64')) {
    throw new Error('Unsupported host platform');
  }
}

async function fetchJson(fetcher: typeof fetch, url: string): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await fetchBytes(fetcher, url)));
}

async function fetchBytes(fetcher: typeof fetch, url: string): Promise<Uint8Array> {
  const response = await fetcher(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': githubApiVersion,
    },
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  if (!response.ok) throw new Error(`Official release request failed (${response.status})`);
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > responseLimit)) {
    throw new Error('Official release response is too large');
  }
  if (!response.body) throw new Error('Official release response has no body');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > responseLimit) throw new Error('Official release response is too large');
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

interface ReleaseAsset {
  url: string;
  digest: string;
}

function releaseDetails(value: unknown, version: string, now: Date): {
  manifest: ReleaseAsset;
  manifestBundle: ReleaseAsset;
  imageBundle: ReleaseAsset;
} {
  if (!isRecord(value)) throw invalidRelease();
  const tag = `v${version}`;
  const publishedAt = typeof value.published_at === 'string' ? Date.parse(value.published_at) : Number.NaN;
  const expectedReleaseUrl = `https://github.com/${OFFICIAL_REPOSITORY}/releases/tag/${tag}`;
  if (
    value.tag_name !== tag || value.draft !== false || value.prerelease !== false || value.immutable !== true ||
    value.html_url !== expectedReleaseUrl || !Number.isFinite(publishedAt) || publishedAt > now.getTime() ||
    !Array.isArray(value.assets)
  ) throw invalidRelease();

  const assets = value.assets.filter(isRecord);
  const officialAsset = (name: string): ReleaseAsset => {
    const matches = assets.filter((asset) => asset.name === name);
    const expectedUrl = `https://github.com/${OFFICIAL_REPOSITORY}/releases/download/${tag}/${name}`;
    if (matches.length !== 1 || matches[0].browser_download_url !== expectedUrl ||
      typeof matches[0].digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(matches[0].digest)) {
      throw invalidRelease();
    }
    return { url: expectedUrl, digest: matches[0].digest };
  };
  return {
    manifest: officialAsset(UPDATE_MANIFEST_ASSET),
    manifestBundle: officialAsset(UPDATE_MANIFEST_ATTESTATION_ASSET),
    imageBundle: officialAsset(UPDATE_IMAGE_ATTESTATION_ASSET),
  };
}

async function withIsolatedGhEnvironment<T>(
  stateDirectory: string,
  operation: (environment: NodeJS.ProcessEnv) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(stateDirectory, '.gh-'));
  const configDirectory = join(directory, 'config');
  const cacheDirectory = join(directory, 'cache');
  try {
    await mkdir(configDirectory, { mode: 0o700 });
    await mkdir(cacheDirectory, { mode: 0o700 });
    const environment = { ...process.env };
    for (const name of githubEnvironmentKeys) delete environment[name];
    environment.GH_CONFIG_DIR = configDirectory;
    environment.XDG_CACHE_HOME = cacheDirectory;
    environment.GH_PROMPT_DISABLED = '1';
    return await operation(environment);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function verifyDigest(bytes: Uint8Array, digest: string): void {
  const actual = createHash('sha256').update(bytes).digest();
  const expected = Buffer.from(digest.slice('sha256:'.length), 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error('Release asset digest mismatch');
  }
}

function parseManifestBytes(bytes: Uint8Array): UpdateManifest {
  try {
    return parseUpdateManifest(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    throw new Error('Invalid update manifest');
  }
}

function assertCompatibility(installed: InstalledState, target: UpdateManifest, updaterVersion: string): void {
  parseStableVersion(installed.version);
  parseStableVersion(updaterVersion);
  if (compareStableVersions(target.version, installed.version) <= 0) throw new Error('Target version is not newer');
  if (compareStableVersions(installed.version, target.compatibility.minimumDirectUpgradeFrom) < 0) {
    throw new Error('Installed version is below the direct upgrade floor');
  }
  if (compareStableVersions(updaterVersion, target.compatibility.minimumUpdaterVersion) < 0) {
    throw new Error('Updater version is incompatible');
  }
  if (compareStableVersions(installed.version, target.compatibility.rollbackSafeFrom) < 0) {
    throw new Error('Installed version is below the rollback floor');
  }
  if (
    target.compatibility.composeContract !== installed.composeContract ||
    target.compatibility.environmentContract !== installed.environmentContract ||
    target.compatibility.updaterProtocol !== installed.updaterProtocol
  ) throw new Error('Update contract is incompatible');
}

async function verifyManagedFiles(config: UpdaterConfig): Promise<void> {
  const paths: Array<[string, 'file' | 'directory']> = [
    [config.composeFile, 'file'],
    [config.environmentFile, 'file'],
    [config.imageEnvironmentFile, 'file'],
    [config.stateDirectory, 'directory'],
    [config.backupDirectory, 'directory'],
  ];
  for (const [path, kind] of paths) {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || (kind === 'file' ? !metadata.isFile() : !metadata.isDirectory())) {
      throw new Error('Managed file preflight failed');
    }
  }
}

async function verifyConfiguredImage(config: UpdaterConfig, installedDigest: string): Promise<void> {
  const expected = `TOME_CMS_APP_IMAGE='${OFFICIAL_IMAGE_REPOSITORY}@${installedDigest}'\n`;
  if (await readFile(config.imageEnvironmentFile, 'utf8') !== expected) {
    throw new Error('Installed state and configured image disagree');
  }
}

async function successfulCommand(
  dependencies: VerifyDependencies,
  executable: string,
  args: readonly string[],
  timeoutMs: number,
  message: string,
  environment?: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  const result = await dependencies.runCommand(executable, args,
    environment ? { timeoutMs, env: environment } : { timeoutMs });
  if (result.code !== 0) throw new Error(message);
  return result;
}

function verifyComposeHealth(output: string): void {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    try {
      value = output.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
    } catch {
      throw new Error('Invalid Compose health response');
    }
  }
  if (!Array.isArray(value)) throw new Error('Invalid Compose health response');
  const required = new Set(['app', 'postgres', 'seaweedfs']);
  for (const service of value) {
    if (!isRecord(service) || typeof service.Service !== 'string' || !required.has(service.Service)) {
      throw new Error('Invalid Compose health response');
    }
    if (service.State !== 'running' || service.Health !== 'healthy') {
      throw new Error('Compose services are not healthy');
    }
    required.delete(service.Service);
  }
  if (required.size > 0) throw new Error('Compose services are not healthy');
}

function currentPlatform(): string {
  if (process.platform !== 'linux') return `${process.platform}/${process.arch}`;
  if (process.arch === 'x64') return 'linux/amd64';
  if (process.arch === 'arm64') return 'linux/arm64';
  return `linux/${process.arch}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidRelease(): Error {
  return new Error('Invalid official release');
}
