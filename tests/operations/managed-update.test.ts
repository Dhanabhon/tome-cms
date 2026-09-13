import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, lstat, readFile, rm, statfs, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import test from 'node:test';

import { backupManifestSchema } from '../../scripts/backup.js';
import { getUpdateInstallability } from '../../src/server/update/admin.js';
import { getUpdaterStatus, requestUpdate, type UpdaterStatus } from '../../src/server/update/updater-client.js';
import {
  OFFICIAL_IMAGE_REPOSITORY,
  OFFICIAL_REPOSITORY,
  UPDATE_IMAGE_ATTESTATION_ASSET,
  UPDATE_MANIFEST_ASSET,
  UPDATE_MANIFEST_ATTESTATION_ASSET,
  type UpdateManifest,
} from '../../src/update/contracts.js';
import type { UpdaterConfig } from '../../src/updater/config.js';
import { runCommand as runProcess, type CommandResult } from '../../src/updater/process.js';
import { createUpdaterServer } from '../../src/updater/server.js';
import { createUpdaterStateStore, type InstalledState, type UpdateJob } from '../../src/updater/state.js';
import { applyUpdate, type UpdateDependencies } from '../../src/updater/transaction.js';
import { runPreflight, verifyTargetRelease, type VerifyDependencies } from '../../src/updater/verify.js';

const nonce = randomUUID().replaceAll('-', '').slice(0, 12);
const projectName = `tomecms-test-${nonce}` as const;
const suiteRoot = join(tmpdir(), `tomecms-test-managed-update-${nonce}`);
const composeFile = join(suiteRoot, 'compose.yaml');
const environmentFile = join(suiteRoot, 'fixture.env');
const baseImageEnvironmentFile = join(suiteRoot, 'image.env');
const imageTags = {
  previous: `${projectName}-app:1.0.0`,
  target: `${projectName}-app:1.0.1`,
} as const;
const servers = new Set<Server>();
const ownedContainerIds = new Set<string>();
const ownedImageIds = new Set<string>();
let composeCreated = false;

assertSafeScope(projectName, suiteRoot);

// Register cleanup before mkdir, build, or Compose can mutate the host.
test.after(async () => {
  const failures: Error[] = [];
  for (const server of servers) {
    try { await closeServer(server); } catch (error) { failures.push(asError(error)); }
  }
  if (composeCreated) {
    try {
      await dockerChecked(composeArgs(baseImageEnvironmentFile, ['down', '--volumes', '--remove-orphans']), {
        env: dockerEnvironment(imageTags.previous, false), timeoutMs: 120_000,
      });
    } catch (error) { failures.push(asError(error)); }
  }
  for (const tag of Object.values(imageTags)) {
    try {
      const inspection = await dockerChecked(['image', 'inspect', '--format', '{{.Id}}', tag], {
        allowFailure: true, timeoutMs: 30_000,
      });
      if (inspection.code === 0) {
        const id = inspection.stdout.trim();
        assertImageId(id);
        ownedImageIds.add(id);
        await dockerChecked(['image', 'rm', '--force', tag], { timeoutMs: 30_000 });
      }
    } catch (error) { failures.push(asError(error)); }
  }
  try {
    const labelled = await dockerChecked([
      'image', 'ls', '--no-trunc', '--filter', `label=tomecms.test.project=${projectName}`, '--format', '{{.ID}}',
    ], { timeoutMs: 30_000 });
    for (const id of lines(labelled.stdout)) {
      assertImageId(id);
      ownedImageIds.add(id);
      await dockerChecked(['image', 'rm', '--force', id], { timeoutMs: 30_000 });
    }
  } catch (error) { failures.push(asError(error)); }
  try { await rm(suiteRoot, { recursive: true, force: true }); } catch (error) { failures.push(asError(error)); }
  try {
    assert.deepEqual(await resourceInventory(), { containers: [], networks: [], volumes: [], images: [] });
  } catch (error) { failures.push(asError(error)); }
  if (failures.length) throw new AggregateError(failures, 'Managed-update fixture cleanup failed');
});

test('managed 1.0.0 to 1.0.1 update is isolated, recoverable, and preserves infrastructure',
  { timeout: 240_000 }, async (t) => {
    t.diagnostic(`Docker fixture project: ${projectName}`);
    t.diagnostic(`Docker fixture root: ${suiteRoot}`);
    await t.test('refuses unsafe names and check-only mode creates no updater socket', async () => {
      assert.throws(() => assertSafeScope('tomecms', suiteRoot), /unsafe/i);
      assert.throws(() => assertSafeScope(projectName, '/var/lib/tome-cms'), /unsafe/i);
      assert.throws(() => assertDockerScope(['compose', '-p', 'tomecms', 'down']), /unsafe/i);
      const socketPath = join(suiteRoot, 'check-only.sock');
      assert.deepEqual(getUpdateInstallability('check-only'), {
        mode: 'check-only', installable: false,
        reason: 'This installation is configured for update checks only.',
      });
      await assert.rejects(lstat(socketPath), { code: 'ENOENT' });
    });

    await mkdir(suiteRoot, { mode: 0o700 });
    const fixture = await buildFixture();
    await writeFixtureFiles(fixture.port, fixture.images.previous.digest);
    composeCreated = true;
    await dockerSuccess(composeArgs(baseImageEnvironmentFile, ['up', '-d', '--wait']), {
      env: dockerEnvironment(fixture.images.previous.id, false), timeoutMs: 120_000,
    });

    const infrastructure = await infrastructureSnapshot(baseImageEnvironmentFile, fixture.images.previous.id);
    const publicBefore = await publicContract(fixture.port);
    assert.deepEqual(publicBefore.body, expectedPublicSite);
    assert.equal(publicBefore.rootStatus, 404);

    await t.test('managed Unix service reports installed 1.0.0', async () => {
      const scenario = await createScenario('success', fixture);
      try {
        const status = await getUpdaterStatus({ socketPath: scenario.config.socketPath });
        assertManaged(status);
        assert.deepEqual(status.installed, { version: '1.0.0', imageDigest: fixture.images.previous.digest });
        assert.equal(status.job, null);
      } finally { await closeScenario(scenario); }
    });

    await t.test('digest plus manifest and image attestation failures occur before stop', async () => {
      for (const mode of ['bad-manifest-digest', 'bad-manifest-attestation', 'bad-image-attestation'] as const) {
        const scenario = await createScenario(mode, fixture);
        try {
          const migrationBefore = await migrationCount(scenario.config, fixture.images.previous.id);
          const job = await install(scenario);
          assert.equal(job.phase, 'rolled_back', scenario.errors.join('; '));
          assert.equal(scenario.stopCount, 0);
          assert.equal(await migrationCount(scenario.config, fixture.images.previous.id), migrationBefore);
          assert.equal((await scenario.state.readInstalled()).imageDigest, fixture.images.previous.digest);
          assert.equal(scenario.attestations.length,
            mode === 'bad-manifest-digest' ? 0 : mode === 'bad-manifest-attestation' ? 1 : 2);
          assertAttestationPolicy(scenario, fixture.manifest);
        } finally { await closeScenario(scenario); }
      }
      assert.deepEqual(await infrastructureSnapshot(baseImageEnvironmentFile, fixture.images.previous.id), infrastructure);
    });

    await t.test('rollback-incompatible release is rejected after both attestations and before stop', async () => {
      const scenario = await createScenario('rollback-incompatible', fixture);
      try {
        const job = await install(scenario);
        assert.equal(job.phase, 'rolled_back', scenario.errors.join('; '));
        assert.equal(scenario.stopCount, 0);
        assert.equal(scenario.attestations.length, 2);
        assertAttestationPolicy(scenario, fixture.manifest);
        assert.equal((await scenario.state.readInstalled()).imageDigest, fixture.images.previous.digest);
      } finally { await closeScenario(scenario); }
    });

    await t.test('successful update writes a complete backup, migrates once, and switches only app', async () => {
      const scenario = await createScenario('success', fixture);
      try {
        const migrationBefore = await migrationCount(scenario.config, fixture.images.previous.id);
        const job = await install(scenario);
        assert.equal(job.phase, 'succeeded', scenario.errors.join('; '));
        assert.equal(scenario.stopCount, 1);
        assert.equal(scenario.attestations.length, 2);
        assertAttestationPolicy(scenario, fixture.manifest);
        assert.equal(await migrationCount(scenario.config, fixture.images.target.id), migrationBefore + 1);
        assert.deepEqual(await scenario.state.readInstalled(), {
          ...fixture.installed,
          version: '1.0.1', imageDigest: fixture.images.target.digest,
          installedAt: '2026-09-20T11:00:00.000Z',
        });
        assert.equal(await readFile(scenario.config.imageEnvironmentFile, 'utf8'),
          imageEnvironment(fixture.images.target.digest));
        await assertCompleteBackup(job, '1.0.0');
        assert.equal(await runningAppImage(scenario.config, fixture.images.target.id), fixture.images.target.id);
        assert.deepEqual(await infrastructureSnapshot(scenario.config.imageEnvironmentFile, fixture.images.target.id), infrastructure);
        assert.deepEqual(await publicContract(fixture.port), publicBefore);
      } finally { await closeScenario(scenario); }
    });

    await selectApp(baseImageEnvironmentFile, fixture.images.previous.digest, fixture.images.previous.id, false);
    assert.equal(await runningAppImage(baseConfig(baseImageEnvironmentFile, fixture.port), fixture.images.previous.id),
      fixture.images.previous.id);

    await t.test('real unhealthy target rolls back to 1.0.0 without replacing services or volumes', async () => {
      const scenario = await createScenario('target-unhealthy', fixture);
      try {
        const migrationBefore = await migrationCount(scenario.config, fixture.images.previous.id);
        const job = await install(scenario);
        assert.equal(job.phase, 'rolled_back', scenario.errors.join('; '));
        assert.equal(job.errorCode, 'health_failed');
        assert.equal(scenario.targetVersionObserved, '1.0.1');
        assert.ok(scenario.targetHealthFailures >= 1);
        assert.equal(await migrationCount(scenario.config, fixture.images.previous.id), migrationBefore + 1);
        assert.equal((await scenario.state.readInstalled()).imageDigest, fixture.images.previous.digest);
        assert.equal(await readFile(scenario.config.imageEnvironmentFile, 'utf8'), imageEnvironment(fixture.images.previous.digest));
        assert.equal(await runningAppImage(scenario.config, fixture.images.previous.id), fixture.images.previous.id);
        assert.deepEqual(await infrastructureSnapshot(scenario.config.imageEnvironmentFile, fixture.images.previous.id), infrastructure);
        assert.deepEqual(await publicContract(fixture.port), publicBefore);
      } finally { await closeScenario(scenario); }
    });
  });

type ScenarioMode = 'success' | 'bad-manifest-digest' | 'bad-manifest-attestation' |
  'bad-image-attestation' | 'rollback-incompatible' | 'target-unhealthy';
interface FixtureImage { digest: string; id: string; tag: string; version: '1.0.0' | '1.0.1' }
interface Fixture {
  images: { previous: FixtureImage; target: FixtureImage };
  installed: InstalledState;
  manifest: UpdateManifest;
  port: number;
}
interface AttestationCall { args: readonly string[]; environment: NodeJS.ProcessEnv }
interface Scenario {
  attestations: AttestationCall[];
  config: UpdaterConfig;
  errors: string[];
  mode: ScenarioMode;
  server: Server;
  state: ReturnType<typeof createUpdaterStateStore>;
  stopCount: number;
  targetHealthFailures: number;
  targetVersionObserved: string | null;
}
interface InfrastructureSnapshot { postgres: ServiceIdentity; seaweedfs: ServiceIdentity }
interface ServiceIdentity { containerId: string; imageId: string; volumes: string[] }
interface ResourceInventory { containers: string[]; networks: string[]; volumes: string[]; images: string[] }

const expectedPublicSite = {
  data: {
    author: null, defaultLocale: 'th', description: 'A stable public API fixture', name: 'TomeCMS fixture',
    supportedLocales: ['th', 'en'], tagline: 'Publish clearly', timezone: 'Asia/Bangkok',
    updatedAt: '2026-09-20T08:00:00.000Z',
  },
};

async function buildFixture(): Promise<Fixture> {
  const fixtureRoot = join(suiteRoot, 'app-fixture');
  await mkdir(fixtureRoot, { mode: 0o700 });
  await writeFile(join(fixtureRoot, 'main.go'), fixtureSource);
  await writeFile(join(fixtureRoot, 'Dockerfile'), [
    'FROM scratch', 'ARG BINARY', 'ARG VERSION', 'COPY ${BINARY} /fixture',
    'LABEL org.opencontainers.image.version=${VERSION}', 'ENTRYPOINT ["/fixture"]', '',
  ].join('\n'));

  const architectureResult = await dockerSuccess(['info', '--format', '{{.Architecture}}'], { timeoutMs: 30_000 });
  const dockerArchitecture = architectureResult.stdout.trim();
  const goArchitecture = dockerArchitecture === 'aarch64' || dockerArchitecture === 'arm64' ? 'arm64' :
    dockerArchitecture === 'x86_64' || dockerArchitecture === 'amd64' ? 'amd64' : '';
  assert.ok(goArchitecture, `Unsupported Docker architecture: ${dockerArchitecture}`);

  const build = async (version: FixtureImage['version'], tag: string): Promise<FixtureImage> => {
    const binary = `fixture-${version}`;
    const compiled = await runProcess('go', [
      'build', '-trimpath', '-ldflags', `-s -w -X main.version=${version}`, '-o', binary, 'main.go',
    ], {
      cwd: fixtureRoot,
      env: { ...process.env, CGO_ENABLED: '0', GOOS: 'linux', GOARCH: goArchitecture },
      timeoutMs: 120_000,
    });
    assert.equal(compiled.code, 0, compiled.stderr);
    await dockerSuccess([
      'build', '--label', `tomecms.test.project=${projectName}`,
      '--build-arg', `BINARY=${binary}`, '--build-arg', `VERSION=${version}`, '-t', tag, fixtureRoot,
    ], { timeoutMs: 120_000 });
    const inspected = await dockerSuccess(['image', 'inspect', '--format', '{{.Id}}', tag], { timeoutMs: 30_000 });
    const id = inspected.stdout.trim();
    assertImageId(id);
    ownedImageIds.add(id);
    return { digest: id, id, tag, version };
  };
  const previous = await build('1.0.0', imageTags.previous);
  const target = await build('1.0.1', imageTags.target);
  assert.notEqual(previous.id, target.id);
  const installed: InstalledState = {
    version: '1.0.0', imageDigest: previous.digest, composeContract: 1, environmentContract: 1,
    updaterProtocol: 1, installedAt: '2026-09-20T09:00:00.000Z',
  };
  return { images: { previous, target }, installed, manifest: releaseManifest(target.digest, 'success'), port: await freePort() };
}

async function writeFixtureFiles(port: number, previousDigest: string): Promise<void> {
  await writeFile(join(suiteRoot, 'seaweedfs-s3.json'), JSON.stringify({
    identities: [{ name: 'anonymous', actions: ['Read'] }],
  }));
  await writeFile(environmentFile, [
    `APP_PORT=${port}`, 'POSTGRES_PASSWORD=tomecms-test-only', 'S3_BUCKET=tomecms-test-media',
    'S3_ACCESS_KEY_ID=tomecms-test-access', 'S3_SECRET_ACCESS_KEY=tomecms-test-secret',
    'TOME_CMS_FIXTURE_UNHEALTHY=0', '',
  ].join('\n'), { mode: 0o600 });
  await writeFile(baseImageEnvironmentFile, imageEnvironment(previousDigest), { mode: 0o600 });
  await writeFile(composeFile, `services:
  postgres:
    image: postgres:17-alpine
    labels: { tomecms.test.project: "${projectName}" }
    environment:
      POSTGRES_DB: tomecms
      POSTGRES_USER: tomecms
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U tomecms -d tomecms"]
      interval: 1s
      timeout: 2s
      retries: 30
    volumes: ["postgres-data:/var/lib/postgresql/data"]
  seaweedfs:
    image: chrislusf/seaweedfs:4.46
    labels: { tomecms.test.project: "${projectName}" }
    command: ["mini", "-dir=/data", "-bucket=\${S3_BUCKET}", "-s3.config=/etc/seaweedfs/s3.json", "-admin.ui=false", "-webdav=false", "-s3.port.iceberg=0", "-s3.port.lance=0", "-master.telemetry=false"]
    environment:
      AWS_ACCESS_KEY_ID: \${S3_ACCESS_KEY_ID}
      AWS_SECRET_ACCESS_KEY: \${S3_SECRET_ACCESS_KEY}
    healthcheck:
      test: ["CMD", "curl", "-sS", "--max-time", "2", "-o", "/dev/null", "http://127.0.0.1:8333/"]
      interval: 1s
      timeout: 2s
      retries: 30
    volumes: ["seaweedfs-data:/data"]
    configs:
      - source: seaweedfs-s3-config
        target: /etc/seaweedfs/s3.json
  app:
    image: \${TOME_CMS_APP_IMAGE}
    labels: { tomecms.test.project: "${projectName}" }
    environment:
      FIXTURE_UNHEALTHY: \${TOME_CMS_FIXTURE_UNHEALTHY:-0}
    depends_on:
      postgres: { condition: service_healthy }
      seaweedfs: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "/fixture", "healthcheck"]
      interval: 500ms
      timeout: 2s
      retries: 20
    ports: ["127.0.0.1:\${APP_PORT}:4321"]
    volumes: ["fixture-state:/fixture-state"]
volumes:
  postgres-data:
    labels: { tomecms.test.project: "${projectName}" }
  seaweedfs-data:
    labels: { tomecms.test.project: "${projectName}" }
  fixture-state:
    labels: { tomecms.test.project: "${projectName}" }
configs:
  seaweedfs-s3-config:
    file: ./seaweedfs-s3.json
`);
}

async function createScenario(mode: ScenarioMode, fixture: Fixture): Promise<Scenario> {
  const root = join(suiteRoot, `case-${randomUUID()}`);
  const stateDirectory = join(root, 'state');
  const backupDirectory = join(root, 'backups');
  const imageEnvironmentFile = join(stateDirectory, 'image.env');
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  await mkdir(backupDirectory, { mode: 0o700 });
  await writeFile(imageEnvironmentFile, imageEnvironment(fixture.images.previous.digest), { mode: 0o600 });
  const config: UpdaterConfig = {
    configVersion: 1, projectName, composeFile, environmentFile, imageEnvironmentFile, stateDirectory,
    backupDirectory, socketPath: join(root, 'updater.sock'), statusPath: join(root, 'status.json'),
    appHealthUrl: `http://127.0.0.1:${fixture.port}/health/ready`, minimumFreeBytes: 1,
  };
  const state = createUpdaterStateStore(config);
  await state.writeInstalled(fixture.installed);
  const scenario: Scenario = {
    attestations: [], config, errors: [], mode, server: undefined as unknown as Server,
    state, stopCount: 0, targetHealthFailures: 0, targetVersionObserved: null,
  };
  const manifest = releaseManifest(fixture.images.target.digest, mode);
  const release = releaseFixture(manifest, mode);
  const fetcher: typeof fetch = async (request, init) => {
    const url = String(request);
    if (url === `https://api.github.com/repos/${OFFICIAL_REPOSITORY}/releases/tags/v1.0.1`) return Response.json(release.metadata);
    if (url.startsWith(`https://github.com/${OFFICIAL_REPOSITORY}/releases/download/v1.0.1/`)) {
      const name = url.split('/').at(-1)!;
      const bytes = release.assets.get(name);
      if (!bytes) throw new Error(`Unknown release asset: ${name}`);
      return new Response(new Uint8Array(bytes));
    }
    if (url === config.appHealthUrl) {
      const response = await fetch(request, init);
      if (!response.ok && await selectedDigest(config.imageEnvironmentFile) === fixture.images.target.digest) {
        scenario.targetHealthFailures += 1;
      }
      return response;
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const runCommand: UpdateDependencies['runCommand'] = async (executable, args, options) => {
    assert.ok(options.timeoutMs > 0);
    if (executable === 'gh') return ghBoundary(scenario, manifest, release, args, options);
    assert.equal(executable, 'docker');
    if (args[0] === 'pull') {
      assert.deepEqual(args, ['pull', `${OFFICIAL_IMAGE_REPOSITORY}@${fixture.images.target.digest}`]);
      return commandResult();
    }
    if (args[0] === 'run') {
      const name = args[args.indexOf('--name') + 1];
      assert.match(name ?? '', new RegExp(`^${projectName}-update-[0-9a-f-]{36}-inventory$`));
      assert.ok(args.includes(`${OFFICIAL_IMAGE_REPOSITORY}@${fixture.images.target.digest}`));
      return commandResult(0, JSON.stringify(['001_system', '008_update_rate_limit_actions']));
    }
    const digest = await selectedDigest(config.imageEnvironmentFile);
    const localImage = digest === fixture.images.target.digest ? fixture.images.target.id : fixture.images.previous.id;
    const unhealthy = mode === 'target-unhealthy' && digest === fixture.images.target.digest;
    const action = composeAction(args);
    if (action === 'stop') scenario.stopCount += 1;
    let result: CommandResult;
    try {
      result = await dockerChecked(args, {
        env: dockerEnvironment(localImage, unhealthy), timeoutMs: options.timeoutMs,
      });
    } catch (error) {
      scenario.errors.push(`${action ?? args[0]}: ${asError(error).message}`);
      throw error;
    }
    if (action === 'run') {
      scenario.errors.push(`run stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)}`);
      if (args.includes('backup')) {
        const receipt = JSON.parse(result.stdout) as { backupDirectory: string };
        const path = join(config.backupDirectory, basename(receipt.backupDirectory), 'manifest.json');
        scenario.errors.push(`manifest=${await readFile(path, 'utf8')}`);
      }
    }
    if (args[0] === 'ps') scenario.errors.push(`ps stdout=${JSON.stringify(result.stdout)}`);
    if (action === 'up' && digest === fixture.images.target.digest) {
      const observed = await fetch(`http://127.0.0.1:${fixture.port}/__fixture/version`);
      scenario.targetVersionObserved = await observed.text();
    }
    return result;
  };
  const verifyDependencies: VerifyDependencies = {
    fetcher, runCommand, statfs, now: () => new Date('2026-09-20T11:00:00.000Z'),
    hostPlatform: () => process.arch === 'arm64' ? 'linux/arm64' : 'linux/amd64',
  };
  const dependencies: UpdateDependencies = {
    fetcher, now: verifyDependencies.now, runCommand,
    runPreflight: (input) => runPreflight({ ...input, dependencies: verifyDependencies }),
    sleep: async () => undefined,
    verifyTargetRelease: async (input) => {
      try { return await verifyTargetRelease({ ...input, dependencies: verifyDependencies }); }
      catch (error) { scenario.errors.push(asError(error).message); throw error; }
    },
  };
  const server = createUpdaterServer({
    state,
    apply: ({ requestId, version }) => state.createJob({ requestId, targetVersion: version }),
    execute: ({ requestId, version }) => applyUpdate({ config, dependencies, requestId, state, updaterVersion: '1.0.0', version }),
  });
  scenario.server = server;
  servers.add(server);
  server.listen(config.socketPath);
  await once(server, 'listening');
  return scenario;
}

async function install(scenario: Scenario): Promise<UpdateJob> {
  await requestUpdate({ requestId: randomUUID(), socketPath: scenario.config.socketPath, timeoutMs: 5_000, version: '1.0.1' });
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const status = await getUpdaterStatus({ socketPath: scenario.config.socketPath, timeoutMs: 5_000 });
    assertManaged(status);
    if (status.job && ['succeeded', 'rolled_back', 'failed_manual_recovery'].includes(status.job.phase)) {
      const job = await scenario.state.readJob();
      assert.ok(job);
      return job;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error('Updater operation did not finish');
}

function releaseManifest(targetDigest: string, mode: ScenarioMode): UpdateManifest {
  return {
    format: 'tomecms-update', manifestVersion: 1, product: 'tomecms', channel: 'stable',
    version: '1.0.1', releasedAt: '2026-09-20T10:00:00.000Z',
    source: { repository: OFFICIAL_REPOSITORY, commit: '0'.repeat(40) },
    image: { repository: OFFICIAL_IMAGE_REPOSITORY, digest: targetDigest, platforms: ['linux/amd64', 'linux/arm64'] },
    compatibility: {
      minimumDirectUpgradeFrom: '1.0.0', minimumUpdaterVersion: '1.0.0', targetMigration: '008_update_rate_limit_actions',
      rollbackSafeFrom: mode === 'rollback-incompatible' ? '1.0.1' : '1.0.0',
      composeContract: 1, environmentContract: 1, updaterProtocol: 1,
    },
    releaseNotesUrl: `https://github.com/${OFFICIAL_REPOSITORY}/releases/tag/v1.0.1`,
  };
}

function releaseFixture(manifest: UpdateManifest, mode: ScenarioMode) {
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const manifestBundle = Buffer.from('manifest-attestation-bundle');
  const imageBundle = Buffer.from('image-attestation-bundle');
  const assets = new Map<string, Buffer>([
    [UPDATE_MANIFEST_ASSET, manifestBytes], [UPDATE_MANIFEST_ATTESTATION_ASSET, manifestBundle],
    [UPDATE_IMAGE_ATTESTATION_ASSET, imageBundle],
  ]);
  return {
    assets,
    metadata: {
      tag_name: 'v1.0.1', draft: false, prerelease: false, immutable: true,
      published_at: '2026-09-20T10:01:00.000Z',
      html_url: `https://github.com/${OFFICIAL_REPOSITORY}/releases/tag/v1.0.1`,
      assets: [...assets].map(([name, bytes]) => ({
        name, browser_download_url: `https://github.com/${OFFICIAL_REPOSITORY}/releases/download/v1.0.1/${name}`,
        digest: `sha256:${mode === 'bad-manifest-digest' && name === UPDATE_MANIFEST_ASSET ? 'f'.repeat(64) : sha256(bytes)}`,
      })),
    },
  };
}

async function ghBoundary(
  scenario: Scenario, manifest: UpdateManifest, release: ReturnType<typeof releaseFixture>, args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<CommandResult> {
  assertCredentialFree(options.env);
  if (args[0] === 'version') return commandResult();
  assert.deepEqual(args.slice(0, 2), ['attestation', 'verify']);
  assert.ok(options.env);
  scenario.attestations.push({ args: [...args], environment: options.env });
  const image = args[2]?.startsWith('oci://') ?? false;
  const bundleIndex = args.indexOf('--bundle');
  assert.ok(bundleIndex > 0);
  const expectedBundle = release.assets.get(image ? UPDATE_IMAGE_ATTESTATION_ASSET : UPDATE_MANIFEST_ATTESTATION_ASSET);
  assert.ok(expectedBundle);
  assert.deepEqual(await readFile(args[bundleIndex + 1]!), expectedBundle);
  if (!image) assert.deepEqual(await readFile(args[2]!), release.assets.get(UPDATE_MANIFEST_ASSET));
  if (scenario.mode === 'bad-manifest-attestation' && !image) return commandResult(1);
  if (scenario.mode === 'bad-image-attestation' && image) return commandResult(1);
  assert.equal(manifest.source.repository, OFFICIAL_REPOSITORY);
  return commandResult();
}

function assertAttestationPolicy(scenario: Scenario, manifest: UpdateManifest): void {
  for (const call of scenario.attestations) {
    const image = call.args[2]?.startsWith('oci://') ?? false;
    const bundleIndex = call.args.indexOf('--bundle');
    assert.deepEqual(call.args, [
      'attestation', 'verify', image ? `oci://${OFFICIAL_IMAGE_REPOSITORY}@${manifest.image.digest}` : call.args[2],
      '--bundle', call.args[bundleIndex + 1], '-R', OFFICIAL_REPOSITORY,
      '--signer-workflow', 'Dhanabhon/tome-cms/.github/workflows/release.yml', '--source-ref', 'refs/tags/v1.0.1',
      '--source-digest', manifest.source.commit, '--deny-self-hosted-runners',
    ]);
    assertCredentialFree(call.environment);
  }
}

function assertCredentialFree(environment: NodeJS.ProcessEnv | undefined): void {
  assert.ok(environment);
  for (const name of [
    'GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_HOST', 'GITHUB_HOST',
    'GH_ENTERPRISE_HOST', 'GITHUB_ENTERPRISE_HOST', 'GITHUB_API_URL', 'GITHUB_GRAPHQL_URL', 'GITHUB_SERVER_URL', 'GH_REPO',
  ]) assert.equal(environment[name], undefined);
  assert.equal(environment.GH_PROMPT_DISABLED, '1');
}

async function assertCompleteBackup(job: UpdateJob, version: string): Promise<void> {
  assert.ok(job.backupDirectory);
  assert.match(basename(job.backupDirectory), /^tomecms-test-backup-[0-9]+$/);
  const manifestBytes = await readFile(join(job.backupDirectory, 'manifest.json'));
  const manifest = backupManifestSchema.parse(JSON.parse(manifestBytes.toString('utf8')));
  assert.equal(manifest.applicationVersion, version);
  const databaseBytes = await readFile(join(job.backupDirectory, manifest.database.file));
  assert.ok(databaseBytes.byteLength > 0);
  assert.equal(manifest.database.sha256, sha256(databaseBytes));
  assert.equal(manifest.objects.length, 1);
  const object = manifest.objects[0]!;
  const objectBytes = await readFile(join(job.backupDirectory, 'objects', ...object.key.split('/')));
  assert.equal(object.sizeBytes, objectBytes.byteLength);
  assert.equal(object.sha256, sha256(objectBytes));
}

async function migrationCount(config: UpdaterConfig, localImage: string): Promise<number> {
  const result = await dockerSuccess(composeFor(config, ['exec', '-T', 'app', '/fixture', 'migration-count']), {
    env: dockerEnvironment(localImage, false), timeoutMs: 30_000,
  });
  const value = Number(result.stdout.trim());
  assert.ok(Number.isSafeInteger(value) && value >= 0);
  return value;
}

async function selectApp(imageEnvironmentFile: string, digest: string, localImage: string, unhealthy: boolean): Promise<void> {
  await writeFile(imageEnvironmentFile, imageEnvironment(digest), { mode: 0o600 });
  await dockerSuccess(composeArgs(imageEnvironmentFile, ['up', '-d', '--no-deps', '--wait', 'app']), {
    env: dockerEnvironment(localImage, unhealthy), timeoutMs: 90_000,
  });
}

async function publicContract(port: number): Promise<{ body: unknown; rootStatus: number }> {
  const [site, root] = await Promise.all([fetch(`http://127.0.0.1:${port}/api/v1/content/site`), fetch(`http://127.0.0.1:${port}/`)]);
  assert.equal(site.status, 200);
  return { body: await site.json(), rootStatus: root.status };
}

async function infrastructureSnapshot(imageEnvironmentFile: string, localImage: string): Promise<InfrastructureSnapshot> {
  return {
    postgres: await serviceIdentity(baseConfig(imageEnvironmentFile, 0), 'postgres', localImage),
    seaweedfs: await serviceIdentity(baseConfig(imageEnvironmentFile, 0), 'seaweedfs', localImage),
  };
}

async function serviceIdentity(config: UpdaterConfig, service: 'postgres' | 'seaweedfs', localImage: string): Promise<ServiceIdentity> {
  const idResult = await dockerSuccess(composeFor(config, ['ps', '--quiet', service]), {
    env: dockerEnvironment(localImage, false), timeoutMs: 30_000,
  });
  const containerId = idResult.stdout.trim();
  assert.match(containerId, /^[0-9a-f]{64}$/);
  ownedContainerIds.add(containerId);
  const inspection = await dockerSuccess(['inspect', '--type', 'container', containerId], { timeoutMs: 30_000 });
  const value: unknown = JSON.parse(inspection.stdout);
  assert.ok(Array.isArray(value) && value.length === 1);
  const record = value[0] as { Image?: unknown; Mounts?: unknown };
  assert.equal(typeof record.Image, 'string');
  assert.ok(Array.isArray(record.Mounts));
  const volumes = record.Mounts.flatMap((mount) => {
    if (typeof mount !== 'object' || mount === null || !('Type' in mount) || !('Name' in mount)) return [];
    return mount.Type === 'volume' && typeof mount.Name === 'string' ? [mount.Name] : [];
  }).sort();
  assert.ok(volumes.length >= 1);
  assert.ok(volumes.every((name) => name.startsWith(`${projectName}_`)));
  return { containerId, imageId: record.Image as string, volumes };
}

async function runningAppImage(config: UpdaterConfig, localImage: string): Promise<string> {
  const idResult = await dockerSuccess(composeFor(config, ['ps', '--quiet', 'app']), {
    env: dockerEnvironment(localImage, false), timeoutMs: 30_000,
  });
  const containerId = idResult.stdout.trim();
  assert.match(containerId, /^[0-9a-f]{64}$/);
  ownedContainerIds.add(containerId);
  const inspection = await dockerSuccess(['inspect', '--type', 'container', containerId, '--format', '{{.Image}}'], { timeoutMs: 30_000 });
  return inspection.stdout.trim();
}

function baseConfig(imageEnvironmentFile: string, port: number): UpdaterConfig {
  return {
    configVersion: 1, projectName, composeFile, environmentFile, imageEnvironmentFile,
    stateDirectory: suiteRoot, backupDirectory: suiteRoot, socketPath: join(suiteRoot, 'unused.sock'),
    statusPath: join(suiteRoot, 'unused.json'), appHealthUrl: `http://127.0.0.1:${port}/health/ready`, minimumFreeBytes: 1,
  };
}

function composeFor(config: UpdaterConfig, tail: readonly string[]): string[] {
  return ['compose', '-p', projectName, '-f', composeFile, '--env-file', environmentFile,
    '--env-file', config.imageEnvironmentFile, ...tail];
}

function composeArgs(imageEnvironmentFile: string, tail: readonly string[]): string[] {
  return composeFor(baseConfig(imageEnvironmentFile, 0), tail);
}

function composeAction(args: readonly string[]): string | undefined {
  return args.find((value) => ['stop', 'run', 'up', 'ps', 'exec', 'down'].includes(value));
}

function dockerEnvironment(localImage: string, unhealthy: boolean): NodeJS.ProcessEnv {
  return { ...process.env, TOME_CMS_APP_IMAGE: localImage, TOME_CMS_FIXTURE_UNHEALTHY: unhealthy ? '1' : '0' };
}

async function dockerSuccess(args: readonly string[], options: { env?: NodeJS.ProcessEnv; timeoutMs: number }): Promise<CommandResult> {
  const result = await dockerChecked(args, options);
  assert.equal(result.code, 0, `docker ${args.join(' ')} failed: ${result.stderr}`);
  return result;
}

async function dockerChecked(
  args: readonly string[], options: { allowFailure?: boolean; env?: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<CommandResult> {
  assertDockerScope(args);
  const result = await runProcess('docker', args, { env: options.env, timeoutMs: options.timeoutMs });
  if (!options.allowFailure && result.code !== 0) throw new Error(`Guarded Docker command failed (${result.code}): ${result.stderr}`);
  return result;
}

function assertDockerScope(args: readonly string[]): void {
  const text = args.join(' ');
  if (args.includes('tomecms') || text.includes('/opt/tome-cms') || text.includes('/etc/tome-cms') ||
    text.includes('/var/lib/tome-cms') || text.includes('/var/backups/tome-cms') ||
    args.some((value) => /^tome-cms(?:-|_|$)/.test(value))) throw new Error('Unsafe Docker scope');
  if (args[0] === 'version' || args[0] === 'info' || args[0] === 'compose' && args[1] === 'version') return;
  if (args[0] === 'compose') {
    const projectIndex = args.indexOf('-p');
    const fileIndex = args.indexOf('-f');
    assert.equal(args[projectIndex + 1], projectName, 'Unsafe Compose project');
    assert.equal(resolve(args[fileIndex + 1] ?? ''), composeFile, 'Unsafe Compose file');
    for (let index = 0; index < args.length; index += 1) if (args[index] === '--env-file') assertSafePath(args[index + 1] ?? '');
    return;
  }
  if (args[0] === 'build') {
    const tagIndex = args.indexOf('-t');
    const labelIndex = args.indexOf('--label');
    assert.ok(Object.values(imageTags).includes(args[tagIndex + 1] as typeof imageTags.previous));
    assert.equal(args[labelIndex + 1], `tomecms.test.project=${projectName}`);
    assertSafePath(args.at(-1) ?? '');
    return;
  }
  if (args[0] === 'image' && args[1] === 'inspect') {
    assert.ok(Object.values(imageTags).includes(args.at(-1) as typeof imageTags.previous));
    return;
  }
  if (args[0] === 'image' && args[1] === 'rm') {
    const target = args.at(-1) ?? '';
    assert.ok(Object.values(imageTags).includes(target as typeof imageTags.previous) || ownedImageIds.has(target));
    return;
  }
  if (args[0] === 'image' && args[1] === 'ls') {
    assert.ok(args.includes(`label=tomecms.test.project=${projectName}`));
    return;
  }
  if (args[0] === 'inspect') {
    const target = args.find((value) => /^[0-9a-f]{64}$/.test(value));
    assert.ok(target && ownedContainerIds.has(target), 'Unsafe container inspection');
    return;
  }
  if (args[0] === 'ps') {
    assert.ok(args.some((value) => value.includes(projectName)), 'Unsafe container listing');
    return;
  }
  if (args[0] === 'rm') {
    assert.ok(args.at(-1)?.startsWith(`${projectName}-update-`), 'Unsafe container removal');
    return;
  }
  if ((args[0] === 'network' || args[0] === 'volume') && args[1] === 'ls') {
    assert.ok(args.some((value) => value.includes(projectName)), 'Unsafe resource listing');
    return;
  }
  throw new Error(`Unsafe or unsupported Docker command: ${text}`);
}

async function resourceInventory(): Promise<ResourceInventory> {
  const query = async (args: string[]) => lines((await dockerSuccess(args, { timeoutMs: 30_000 })).stdout);
  return {
    containers: await query(['ps', '--all', '--filter', `label=com.docker.compose.project=${projectName}`, '--format', '{{.Names}}']),
    networks: await query(['network', 'ls', '--filter', `label=com.docker.compose.project=${projectName}`, '--format', '{{.Name}}']),
    volumes: await query(['volume', 'ls', '--filter', `label=tomecms.test.project=${projectName}`, '--format', '{{.Name}}']),
    images: await query(['image', 'ls', '--filter', `label=tomecms.test.project=${projectName}`, '--format', '{{.ID}}']),
  };
}

function assertSafeScope(project: string, root: string): void {
  if (!/^tomecms-test-[0-9a-f]{12}$/.test(project)) throw new Error('Unsafe test project name');
  const resolvedRoot = resolve(root);
  const tail = relative(resolve(tmpdir()), resolvedRoot);
  if (!tail.split(sep)[0]?.startsWith('tomecms-test-managed-update-') || tail.startsWith(`..${sep}`)) throw new Error('Unsafe test root path');
}

function assertSafePath(path: string): void {
  const tail = relative(suiteRoot, resolve(path));
  assert.ok(tail === '' || !tail.startsWith(`..${sep}`) && !tail.includes(`${sep}..${sep}`), 'Unsafe test path');
}

async function selectedDigest(path: string): Promise<string> {
  const match = /@(sha256:[0-9a-f]{64})/.exec(await readFile(path, 'utf8'));
  assert.ok(match);
  return match[1]!;
}

function imageEnvironment(digest: string): string {
  assert.match(digest, /^sha256:[0-9a-f]{64}$/);
  return `TOME_CMS_APP_IMAGE='${OFFICIAL_IMAGE_REPOSITORY}@${digest}'\n`;
}

function commandResult(code = 0, stdout = ''): CommandResult {
  return { code, stdout, stderr: code === 0 ? '' : 'fixture command failed' };
}

function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function lines(output: string): string[] { return output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).sort(); }
function assertImageId(value: string): asserts value is `sha256:${string}` { assert.match(value, /^sha256:[0-9a-f]{64}$/); }
function assertManaged(status: UpdaterStatus): asserts status is Exclude<UpdaterStatus, { managed: false }> { assert.equal(status.managed, true); }
async function closeScenario(scenario: Scenario): Promise<void> { await closeServer(scenario.server); }
async function closeServer(server: Server): Promise<void> {
  servers.delete(server);
  if (!server.listening) return;
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
}
function asError(value: unknown): Error { return value instanceof Error ? value : new Error(String(value)); }

async function freePort(): Promise<number> {
  const server = createNetServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

const fixtureSource = `package main

import (
  "crypto/sha256"
  "encoding/hex"
  "encoding/json"
  "fmt"
  "io"
  "net/http"
  "os"
  "path/filepath"
  "strconv"
  "strings"
  "time"
)

var version = "dev"

func main() {
  args := os.Args[1:]
  if equal(args, []string{"healthcheck"}) { healthcheck(); return }
  if equal(args, []string{"migration-count"}) { fmt.Print(readCount()); return }
  if equal(args, []string{"npm", "run", "db:migrate"}) { migrate(); return }
  if equal(args, []string{"npm", "run", "--silent", "backup", "--", "--offline", "--direct", "--json", "--output-root", "/backups"}) { backup(); return }
  if len(args) != 0 { panic("unexpected fixture command") }

  mux := http.NewServeMux()
  mux.HandleFunc("/internal/live", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
  mux.HandleFunc("/health/ready", func(w http.ResponseWriter, _ *http.Request) {
    if os.Getenv("FIXTURE_UNHEALTHY") == "1" { http.Error(w, "unhealthy", http.StatusServiceUnavailable); return }
    w.WriteHeader(http.StatusNoContent)
  })
  mux.HandleFunc("/__fixture/version", func(w http.ResponseWriter, _ *http.Request) { _, _ = io.WriteString(w, version) })
  mux.HandleFunc("/api/v1/content/site", func(w http.ResponseWriter, _ *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    _ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{
      "author": nil, "defaultLocale": "th", "description": "A stable public API fixture",
      "name": "TomeCMS fixture", "supportedLocales": []string{"th", "en"},
      "tagline": "Publish clearly", "timezone": "Asia/Bangkok", "updatedAt": "2026-09-20T08:00:00.000Z",
    }})
  })
  mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) { http.NotFound(w, nil) })
  if err := http.ListenAndServe(":4321", mux); err != nil { panic(err) }
}

func healthcheck() {
  response, err := http.Get("http://127.0.0.1:4321/internal/live")
  if err != nil || response.StatusCode != http.StatusNoContent { os.Exit(1) }
  _ = response.Body.Close()
}

func migrate() {
  if err := os.MkdirAll("/fixture-state", 0755); err != nil { panic(err) }
  count := readCount() + 1
  if err := os.WriteFile("/fixture-state/migration-count", []byte(strconv.Itoa(count)), 0644); err != nil { panic(err) }
}

func readCount() int {
  bytes, err := os.ReadFile("/fixture-state/migration-count")
  if os.IsNotExist(err) { return 0 }
  if err != nil { panic(err) }
  value, err := strconv.Atoi(strings.TrimSpace(string(bytes)))
  if err != nil { panic(err) }
  return value
}

func backup() {
  name := fmt.Sprintf("tomecms-test-backup-%d", time.Now().UnixNano())
  root := filepath.Join("/backups", name)
  objectKey := filepath.Join("media", "fixture", "public.webp")
  if err := os.MkdirAll(filepath.Join(root, "objects", filepath.Dir(objectKey)), 0700); err != nil { panic(err) }
  database := []byte("real fixture database dump for " + version)
  object := []byte("real fixture object bytes")
  if err := os.WriteFile(filepath.Join(root, "database.dump"), database, 0600); err != nil { panic(err) }
  if err := os.WriteFile(filepath.Join(root, "objects", objectKey), object, 0600); err != nil { panic(err) }
  manifest := map[string]any{
    "format": "tomecms-backup", "version": 1, "createdAt": time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
    "applicationVersion": version,
    "config": map[string]any{"publicUrl": "https://cms.example.test", "database": "tomecms", "s3Endpoint": "https://media.example.test", "bucket": "tomecms-media"},
    "database": map[string]any{"file": "database.dump", "sha256": digest(database)},
    "records": map[string]any{"siteSettings": 1, "posts": 1, "pages": 1, "mediaItems": 1},
    "objects": []any{map[string]any{"key": "media/fixture/public.webp", "contentType": "image/webp", "sizeBytes": len(object), "sha256": digest(object)}},
  }
  bytes, err := json.MarshalIndent(manifest, "", "  ")
  if err != nil { panic(err) }
  bytes = append(bytes, '\\n')
  if err := os.WriteFile(filepath.Join(root, "manifest.json"), bytes, 0600); err != nil { panic(err) }
  receipt, _ := json.Marshal(map[string]any{"backupDirectory": "/backups/" + name, "manifestSha256": digest(bytes)})
  fmt.Print(string(receipt))
}

func digest(bytes []byte) string { sum := sha256.Sum256(bytes); return hex.EncodeToString(sum[:]) }
func equal(left, right []string) bool {
  if len(left) != len(right) { return false }
  for index := range left { if left[index] != right[index] { return false } }
  return true
}
`;
