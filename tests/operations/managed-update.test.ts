import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, lstat, readFile, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { basename, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { backupManifestSchema } from '../../scripts/backup.js';
import { isBundledFrontendPath } from '../../src/middleware.js';
import { getUpdateInstallability } from '../../src/server/update/admin.js';
import { getUpdaterStatus, requestUpdate, type UpdaterStatus } from '../../src/server/update/updater-client.js';
import { serializePublicSite } from '../../src/server/http/serialize.js';
import {
  OFFICIAL_IMAGE_REPOSITORY,
  OFFICIAL_REPOSITORY,
  UPDATE_IMAGE_ATTESTATION_ASSET,
  UPDATE_MANIFEST_ASSET,
  UPDATE_MANIFEST_ATTESTATION_ASSET,
  type UpdateManifest,
} from '../../src/update/contracts.js';
import type { UpdaterConfig } from '../../src/updater/config.js';
import type { CommandResult } from '../../src/updater/process.js';
import { createUpdaterServer } from '../../src/updater/server.js';
import { createUpdaterStateStore, type InstalledState, type UpdateJob } from '../../src/updater/state.js';
import { applyUpdate, type UpdateDependencies } from '../../src/updater/transaction.js';
import { runPreflight, verifyTargetRelease, type VerifyDependencies } from '../../src/updater/verify.js';

const suiteRoot = await mkdtemp(join(tmpdir(), 'tomecms-test-managed-update-'));
const projectName = `tomecms-test-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const servers = new Set<Server>();

assertSafeScope(projectName, suiteRoot);

test.after(async () => {
  assertSafeScope(projectName, suiteRoot);
  try {
    await Promise.all([...servers].map(closeServer));
  } finally {
    await rm(suiteRoot, { recursive: true, force: true });
  }
});

const previous: InstalledState = {
  version: '1.0.0',
  imageDigest: `sha256:${'a'.repeat(64)}`,
  composeContract: 1,
  environmentContract: 1,
  updaterProtocol: 1,
  installedAt: '2026-09-20T09:00:00.000Z',
};
const targetDigest = `sha256:${'b'.repeat(64)}`;
const targetImage = `${OFFICIAL_IMAGE_REPOSITORY}@${targetDigest}`;
const imageEnvironment = (digest: string) => `TOME_CMS_APP_IMAGE='${OFFICIAL_IMAGE_REPOSITORY}@${digest}'\n`;

type ScenarioMode = 'success' | 'bad-manifest-digest' | 'bad-attestation' | 'target-unhealthy' | 'rollback-incompatible';

interface InfrastructureSnapshot {
  containerImageIds: { postgres: string; seaweedfs: string };
  volumeIds: { postgres: string; seaweedfs: string };
}

interface Scenario {
  appStopCount: number;
  attestationCount: number;
  backupDirectories: string[];
  config: UpdaterConfig;
  healthChecks: { previous: number; target: number };
  infrastructureSnapshot(): InfrastructureSnapshot;
  migrationCount: number;
  server: Server;
  state: ReturnType<typeof createUpdaterStateStore>;
  verificationErrors: string[];
}

test('refuses unsafe operation harness names and paths', () => {
  assert.throws(() => assertSafeScope('tomecms', suiteRoot), /unsafe/i);
  assert.throws(() => assertSafeScope(projectName, '/var/lib/tome-cms'), /unsafe/i);
});

test('check-only mode exposes no updater socket', async () => {
  const socketPath = join(suiteRoot, 'check-only.sock');
  assert.deepEqual(getUpdateInstallability('check-only'), {
    mode: 'check-only', installable: false,
    reason: 'This installation is configured for update checks only.',
  });
  await assert.rejects(lstat(socketPath), { code: 'ENOENT' });
});

test('managed service reports the installed 1.0.0 release', async () => {
  const scenario = await createScenario('success');
  const status = await getUpdaterStatus({ socketPath: scenario.config.socketPath });
  assertManaged(status);
  assert.deepEqual(status.installed, { version: '1.0.0', imageDigest: previous.imageDigest });
  assert.equal(status.job, null);
});

test('invalid release digest and attestation fail before maintenance', async () => {
  for (const mode of ['bad-manifest-digest', 'bad-attestation'] as const) {
    const scenario = await createScenario(mode);
    const job = await install(scenario);
    assert.equal(job.phase, 'rolled_back');
    assert.equal(scenario.appStopCount, 0);
    assert.equal(scenario.migrationCount, 0);
    assert.equal((await scenario.state.readInstalled()).imageDigest, previous.imageDigest);
    assert.equal(scenario.attestationCount, mode === 'bad-attestation' ? 1 : 0, scenario.verificationErrors.join('; '));
  }
});

test('successful apply keeps the public contract, creates a complete backup, and updates only the app', async () => {
  const scenario = await createScenario('success');
  const publicBefore = publicContract();
  const infrastructureBefore = scenario.infrastructureSnapshot();

  const job = await install(scenario);

  assert.equal(job.phase, 'succeeded', scenario.verificationErrors.join('; '));
  assert.equal(scenario.migrationCount, 1);
  assert.ok(scenario.healthChecks.target > 0);
  assert.deepEqual(await scenario.state.readInstalled(), {
    ...previous,
    version: '1.0.1',
    imageDigest: targetDigest,
    installedAt: '2026-09-20T11:00:00.000Z',
  });
  assert.equal(await readFile(scenario.config.imageEnvironmentFile, 'utf8'), imageEnvironment(targetDigest));
  assert.equal(scenario.backupDirectories.length, 1);
  const backup = scenario.backupDirectories[0]!;
  const manifest = backupManifestSchema.parse(JSON.parse(await readFile(join(backup, 'manifest.json'), 'utf8')));
  assert.equal(manifest.applicationVersion, '1.0.0');
  assert.equal(manifest.database.sha256, sha256(await readFile(join(backup, manifest.database.file))));
  assert.equal(manifest.objects.length, 1);
  assert.equal(manifest.objects[0]?.sha256, sha256(await readFile(join(backup, 'objects', ...manifest.objects[0]!.key.split('/')))));
  assert.deepEqual(scenario.infrastructureSnapshot(), infrastructureBefore);
  assert.deepEqual(publicContract(), publicBefore);
  assert.deepEqual(publicBefore, {
    body: {
      data: {
        author: null,
        defaultLocale: 'th',
        description: 'A stable public API fixture',
        name: 'TomeCMS fixture',
        supportedLocales: ['th', 'en'],
        tagline: 'Publish clearly',
        timezone: 'Asia/Bangkok',
        updatedAt: '2026-09-20T08:00:00.000Z',
      },
    },
    headless: { bundledHomeHidden: true, siteApiAvailable: true },
  });
});

test('target health failure restores the 1.0.0 app without replacing infrastructure', async () => {
  const scenario = await createScenario('target-unhealthy');
  const infrastructureBefore = scenario.infrastructureSnapshot();
  const job = await install(scenario);

  assert.equal(job.phase, 'rolled_back');
  assert.equal(job.errorCode, 'health_failed');
  assert.equal(scenario.migrationCount, 1);
  assert.ok(scenario.healthChecks.target > 0);
  assert.ok(scenario.healthChecks.previous > 1);
  assert.equal((await scenario.state.readInstalled()).imageDigest, previous.imageDigest);
  assert.equal(await readFile(scenario.config.imageEnvironmentFile, 'utf8'), imageEnvironment(previous.imageDigest));
  assert.deepEqual(scenario.infrastructureSnapshot(), infrastructureBefore);
});

test('rollback-incompatible release is rejected before app stop', async () => {
  const scenario = await createScenario('rollback-incompatible');
  const job = await install(scenario);
  assert.equal(job.phase, 'rolled_back');
  assert.equal(scenario.appStopCount, 0);
  assert.equal(scenario.migrationCount, 0);
  assert.equal(scenario.attestationCount, 2);
  assert.equal((await scenario.state.readInstalled()).imageDigest, previous.imageDigest);
});

async function createScenario(mode: ScenarioMode): Promise<Scenario> {
  assertSafeScope(projectName, suiteRoot);
  const root = await mkdtemp(join(suiteRoot, 'case-'));
  const stateDirectory = join(root, 'state');
  const backupDirectory = join(root, 'backups');
  const config = {
    configVersion: 1,
    projectName: 'tomecms',
    composeFile: join(root, 'compose.managed.yaml'),
    environmentFile: join(root, 'tome-cms.env'),
    imageEnvironmentFile: join(stateDirectory, 'image.env'),
    stateDirectory,
    backupDirectory,
    socketPath: join(root, 'updater.sock'),
    statusPath: join(root, 'status.json'),
    appHealthUrl: 'http://127.0.0.1:4321/health/ready',
    minimumFreeBytes: 5 * 1024 ** 3,
  } satisfies UpdaterConfig;
  await mkdir(stateDirectory);
  await mkdir(backupDirectory);
  await writeFile(config.composeFile, 'services: {}\n');
  await writeFile(config.environmentFile, 'TOME_CMS_UPDATE_MODE=managed\n');
  await writeFile(config.imageEnvironmentFile, imageEnvironment(previous.imageDigest));

  const state = createUpdaterStateStore(config);
  await state.writeInstalled(previous);
  const scenario: Scenario = {
    appStopCount: 0,
    attestationCount: 0,
    backupDirectories: [],
    config,
    healthChecks: { previous: 0, target: 0 },
    infrastructureSnapshot: () => structuredClone(infrastructure),
    migrationCount: 0,
    server: undefined as unknown as Server,
    state,
    verificationErrors: [],
  };
  const infrastructure: InfrastructureSnapshot = {
    containerImageIds: {
      postgres: `sha256:${'c'.repeat(64)}`,
      seaweedfs: `sha256:${'d'.repeat(64)}`,
    },
    volumeIds: {
      postgres: `${projectName}_postgres-data`,
      seaweedfs: `${projectName}_seaweedfs-data`,
    },
  };
  let appDigest = previous.imageDigest;
  const manifest = releaseManifest(mode);
  const release = releaseFixture(manifest, mode);

  const fetcher: typeof fetch = async (request) => {
    const url = String(request);
    if (url === `https://api.github.com/repos/${OFFICIAL_REPOSITORY}/releases/tags/v1.0.1`) {
      return Response.json(release.metadata);
    }
    if (url.startsWith(`https://github.com/${OFFICIAL_REPOSITORY}/releases/download/v1.0.1/`)) {
      const name = url.split('/').at(-1)!;
      const bytes = release.assets.get(name);
      if (!bytes) throw new Error(`Unknown release asset: ${name}`);
      return new Response(new Uint8Array(bytes));
    }
    if (url === config.appHealthUrl) {
      if (appDigest === targetDigest) {
        scenario.healthChecks.target += 1;
        return new Response('', { status: mode === 'target-unhealthy' ? 503 : 200 });
      }
      scenario.healthChecks.previous += 1;
      return new Response('', { status: 200 });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const runCommand: UpdateDependencies['runCommand'] = async (executable, args, options) => {
    assertSafeScope(projectName, root);
    assert.ok(options.timeoutMs > 0);
    if (executable === 'gh') {
      if (args[0] === 'version') return commandResult();
      if (args[0] === 'attestation' && args[1] === 'verify') {
        scenario.attestationCount += 1;
        assert.ok(args.includes('--bundle'));
        assert.equal(options.env?.GH_TOKEN, undefined);
        assert.equal(options.env?.GITHUB_TOKEN, undefined);
        return commandResult(mode === 'bad-attestation' && !args[2]?.startsWith('oci://') ? 1 : 0);
      }
      throw new Error(`Unexpected gh command: ${args.join(' ')}`);
    }
    assert.equal(executable, 'docker');
    const command = [...args];
    if (infrastructureMutation(command)) throw new Error('Infrastructure mutation is outside the update contract');
    if (command[0] === 'version' || command[0] === 'compose' && command[1] === 'version') return commandResult();
    if (command[0] === 'ps') return commandResult();
    if (command[0] === 'rm') return commandResult();
    if (command[0] === 'pull') {
      assert.deepEqual(command, ['pull', targetImage]);
      return commandResult();
    }
    if (command[0] === 'run') {
      assert.equal(command.includes(targetImage), true);
      return commandResult(0, JSON.stringify(['001_system', '008_update_rate_limit_actions']));
    }
    if (command[0] !== 'compose') throw new Error(`Unexpected docker command: ${command.join(' ')}`);

    const action = command.find((part) => ['ps', 'stop', 'run', 'up'].includes(part));
    if (action === 'ps') return commandResult(0, composeHealth());
    if (action === 'stop') {
      assert.deepEqual(command.slice(-4), ['stop', '--timeout', '30', 'app']);
      scenario.appStopCount += 1;
      return commandResult();
    }
    if (action === 'run' && command.includes('backup')) {
      return commandResult(0, await createCompleteBackup(config, scenario));
    }
    if (action === 'run' && command.includes('db:migrate')) {
      scenario.migrationCount += 1;
      return commandResult();
    }
    if (action === 'up') {
      assert.equal(command.at(-1), 'app');
      const selected = await readFile(config.imageEnvironmentFile, 'utf8');
      const match = /@(sha256:[0-9a-f]{64})/.exec(selected);
      assert.ok(match);
      appDigest = match[1]!;
      return commandResult();
    }
    throw new Error(`Unexpected docker compose command: ${command.join(' ')}`);
  };

  const verifyDependencies: VerifyDependencies = {
    fetcher,
    runCommand,
    statfs: (async () => ({ bsize: 1, bavail: 6 * 1024 ** 3 })) as unknown as VerifyDependencies['statfs'],
    now: () => new Date('2026-09-20T11:00:00.000Z'),
    hostPlatform: () => 'linux/amd64',
  };
  const dependencies: UpdateDependencies = {
    fetcher,
    now: verifyDependencies.now,
    runCommand,
    runPreflight: (input) => runPreflight({ ...input, dependencies: verifyDependencies }),
    sleep: async () => undefined,
    verifyTargetRelease: async (input) => {
      try {
        return await verifyTargetRelease({ ...input, dependencies: verifyDependencies });
      } catch (error) {
        scenario.verificationErrors.push(error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
  };
  const server = createUpdaterServer({
    state,
    apply: ({ requestId, version }) => state.createJob({ requestId, targetVersion: version }),
    execute: ({ requestId, version }) => applyUpdate({
      config, dependencies, requestId, state, updaterVersion: '1.0.0', version,
    }),
  });
  scenario.server = server;
  servers.add(server);
  server.listen(config.socketPath);
  await once(server, 'listening');
  return scenario;
}

async function install(scenario: Scenario): Promise<UpdateJob> {
  await requestUpdate({
    requestId: randomUUID(), socketPath: scenario.config.socketPath,
    timeoutMs: 2_000, version: '1.0.1',
  });
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const status = await getUpdaterStatus({ socketPath: scenario.config.socketPath, timeoutMs: 2_000 });
    assertManaged(status);
    if (status.job && ['succeeded', 'rolled_back', 'failed_manual_recovery'].includes(status.job.phase)) {
      const job = await scenario.state.readJob();
      assert.ok(job);
      return job;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 5));
  }
  throw new Error('Updater operation did not finish');
}

function releaseManifest(mode: ScenarioMode): UpdateManifest {
  return {
    format: 'tomecms-update', manifestVersion: 1, product: 'tomecms', channel: 'stable',
    version: '1.0.1', releasedAt: '2026-09-20T10:00:00.000Z',
    source: { repository: OFFICIAL_REPOSITORY, commit: '0'.repeat(40) },
    image: {
      repository: OFFICIAL_IMAGE_REPOSITORY,
      digest: targetDigest,
      platforms: ['linux/amd64', 'linux/arm64'],
    },
    compatibility: {
      minimumDirectUpgradeFrom: '1.0.0', minimumUpdaterVersion: '1.0.0',
      targetMigration: '008_update_rate_limit_actions',
      rollbackSafeFrom: mode === 'rollback-incompatible' ? '1.0.1' : '1.0.0',
      composeContract: 1, environmentContract: 1, updaterProtocol: 1,
    },
    releaseNotesUrl: 'https://github.com/Dhanabhon/tome-cms/releases/tag/v1.0.1',
  };
}

function releaseFixture(manifest: UpdateManifest, mode: ScenarioMode) {
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const manifestBundle = Buffer.from('manifest-attestation-bundle');
  const imageBundle = Buffer.from('image-attestation-bundle');
  const assets = new Map<string, Buffer>([
    [UPDATE_MANIFEST_ASSET, manifestBytes],
    [UPDATE_MANIFEST_ATTESTATION_ASSET, manifestBundle],
    [UPDATE_IMAGE_ATTESTATION_ASSET, imageBundle],
  ]);
  const releaseAssets = [...assets].map(([name, bytes]) => ({
    name,
    browser_download_url: `https://github.com/${OFFICIAL_REPOSITORY}/releases/download/v1.0.1/${name}`,
    digest: `sha256:${mode === 'bad-manifest-digest' && name === UPDATE_MANIFEST_ASSET
      ? 'f'.repeat(64) : sha256(bytes)}`,
  }));
  return {
    assets,
    metadata: {
      tag_name: 'v1.0.1', draft: false, prerelease: false, immutable: true,
      published_at: '2026-09-20T10:01:00.000Z',
      html_url: `https://github.com/${OFFICIAL_REPOSITORY}/releases/tag/v1.0.1`,
      assets: releaseAssets,
    },
  };
}

async function createCompleteBackup(config: UpdaterConfig, scenario: Scenario): Promise<string> {
  const directory = join(config.backupDirectory, `tomecms-test-backup-${scenario.backupDirectories.length + 1}`);
  const objectKey = 'media/fixture/public.webp';
  const database = Buffer.from('fixture PostgreSQL custom dump');
  const object = Buffer.from('fixture public media object');
  await mkdir(join(directory, 'objects', 'media', 'fixture'), { recursive: true });
  await writeFile(join(directory, 'database.dump'), database);
  await writeFile(join(directory, 'objects', ...objectKey.split('/')), object);
  const manifest = backupManifestSchema.parse({
    format: 'tomecms-backup', version: 1,
    createdAt: '2026-09-20T10:30:00.000Z', applicationVersion: '1.0.0',
    config: {
      publicUrl: 'https://cms.example.test', database: 'tomecms',
      s3Endpoint: 'https://media.example.test', bucket: 'tomecms-media',
    },
    database: { file: 'database.dump', sha256: sha256(database) },
    records: { siteSettings: 1, posts: 1, pages: 1, mediaItems: 1 },
    objects: [{
      key: objectKey, contentType: 'image/webp', sizeBytes: object.byteLength, sha256: sha256(object),
    }],
  });
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(directory, 'manifest.json'), bytes);
  scenario.backupDirectories.push(directory);
  return JSON.stringify({
    backupDirectory: `/backups/${basename(directory)}`,
    manifestSha256: sha256(bytes),
  });
}

function publicContract() {
  const site = serializePublicSite({
    admin_path: '/private-admin', author_avatar_media_id: null,
    author_bio_en: '', author_bio_th: '', author_links: [], author_name: '',
    default_locale: 'th', id: true,
    installed_at: new Date('2026-09-20T07:00:00.000Z'), owner_id: 'private-owner',
    site_description: 'A stable public API fixture', site_name: 'TomeCMS fixture',
    tagline: 'Publish clearly', timezone: 'Asia/Bangkok',
    updated_at: new Date('2026-09-20T08:00:00.000Z'),
  });
  return {
    body: { data: site },
    headless: {
      bundledHomeHidden: isBundledFrontendPath('/'),
      siteApiAvailable: !isBundledFrontendPath('/api/v1/content/site'),
    },
  };
}

function infrastructureMutation(command: readonly string[]): boolean {
  const action = command.find((part) => ['pull', 'stop', 'run', 'up', 'rm', 'down'].includes(part));
  return action !== undefined && command.some((part) => part === 'postgres' || part === 'seaweedfs');
}

function composeHealth(): string {
  return ['app', 'postgres', 'seaweedfs'].map((service) => JSON.stringify({
    Service: service, State: 'running', Health: 'healthy',
  })).join('\n');
}

function commandResult(code = 0, stdout = ''): CommandResult {
  return { code, stdout, stderr: code === 0 ? '' : 'fixture command failed' };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertManaged(status: UpdaterStatus): asserts status is Exclude<UpdaterStatus, { managed: false }> {
  assert.equal(status.managed, true);
}

function assertSafeScope(project: string, root: string): void {
  if (!/^tomecms-test-[0-9a-f]{12}$/.test(project)) throw new Error('Unsafe test project name');
  const resolvedRoot = resolve(root);
  const tail = relative(resolve(tmpdir()), resolvedRoot);
  if (!tail.split(sep)[0]?.startsWith('tomecms-test-') || tail.startsWith(`..${sep}`)) {
    throw new Error('Unsafe test root path');
  }
}

async function closeServer(server: Server): Promise<void> {
  servers.delete(server);
  if (!server.listening) return;
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
}
