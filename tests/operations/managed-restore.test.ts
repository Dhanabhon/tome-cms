import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { cp, mkdir, readFile, realpath, rm, statfs, writeFile } from 'node:fs/promises';
import { request as httpRequest, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';

import { getUpdaterStatus, type UpdaterStatus } from '../../src/server/update/updater-client.js';
import { parseBackupManifest, type BackupManifest } from '../../src/update/backup.js';
import { OFFICIAL_IMAGE_REPOSITORY } from '../../src/update/contracts.js';
import type { UpdaterConfig } from '../../src/updater/config.js';
import { runCommand as runProcess, type CommandResult } from '../../src/updater/process.js';
import { reconcileRestore, runRestore } from '../../src/updater/restore.js';
import { createUpdaterServer } from '../../src/updater/server.js';
import { createUpdaterStateStore, type InstalledState, type RestoreJob } from '../../src/updater/state.js';
import { defaults, runBackup, type UpdateDependencies } from '../../src/updater/transaction.js';
import { assertBackupSpace } from '../../src/updater/verify.js';

// A restore against real PostgreSQL and SeaweedFS. The app is a Go fixture on postgres:17-alpine, so
// its content steps run the real pg_dump, pg_restore and psql, and put objects with the S3 API.
const nonce = randomUUID().replaceAll('-', '').slice(0, 12);
const projectName = `tomecms-test-${nonce}` as const;
const suiteRoot = join(tmpdir(), `tomecms-test-managed-restore-${nonce}`);
const composeFile = join(suiteRoot, 'compose.yaml');
const environmentFile = join(suiteRoot, 'fixture.env');
const baseImageEnvironmentFile = join(suiteRoot, 'image.env');
const imageTag = `${projectName}-app:1.13.0`;
const fixtureInterpolation = {
  POSTGRES_PASSWORD: 'tomecms-test-only',
  S3_BUCKET: 'tomecms-test-media',
  S3_ACCESS_KEY_ID: 'tomecms-test-access',
  S3_SECRET_ACCESS_KEY: 'tomecms-test-secret',
} as const;
const publicUrl = 'https://cms.example.test';
const objectKey = 'owners/123e4567-e89b-42d3-a456-426614174000/2026/09/123e4567-e89b-42d3-a456-426614174001.webp';
const countsQuery = "select json_build_object('siteSettings', (select count(*) from site_settings), " +
  "'posts', (select count(*) from posts), 'pages', (select count(*) from pages), 'mediaItems', (select count(*) from media_items))";
const servers = new Set<Server>();
const ownedContainerIds = new Set<string>();
const ownedImageIds = new Set<string>();
let composeCreated = false;
let fixtureAppPort: number | null = null;
let fixtureImageId: string | null = null;
// The backup root by its real path: a restore takes only a directory named by its real path.
let backupRoot = '';
// The host's dangling volumes before the suite: an image VOLUME makes an unlabelled one per container.
let danglingBefore: Set<string> | null = null;

assertSafeScope(projectName, suiteRoot);

// Register cleanup before mkdir, build, or Compose can mutate the host.
test.after(async () => {
  const failures: Error[] = [];
  for (const server of servers) {
    try { await closeServer(server); } catch (error) { failures.push(asError(error)); }
  }
  if (composeCreated) {
    try {
      await dockerChecked(compose(['down', '--volumes', '--remove-orphans']), { env: dockerEnvironment(), timeoutMs: 120_000 });
    } catch (error) { failures.push(asError(error)); }
  }
  try {
    const inspection = await dockerChecked(['image', 'inspect', '--format', '{{.Id}}', imageTag], { allowFailure: true, timeoutMs: 30_000 });
    if (inspection.code === 0) await dockerChecked(['image', 'rm', '--force', imageTag], { timeoutMs: 30_000 });
  } catch (error) { failures.push(asError(error)); }
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
  try {
    if (danglingBefore) assert.deepEqual((await danglingVolumes()).filter((name) => !danglingBefore!.has(name)), [], 'no dangling volume left behind');
  } catch (error) { failures.push(asError(error)); }
  if (failures.length) throw new AggregateError(failures, 'Managed-restore fixture cleanup failed');
});

test('a restore runs, falls back and survives a restart against real containers', { timeout: 600_000 }, async (t) => {
  t.diagnostic(`Docker fixture project: ${projectName}`);
  t.diagnostic(`Docker fixture root: ${suiteRoot}`);
  danglingBefore = new Set(await danglingVolumes());
  t.diagnostic(`Dangling volumes on the host before the suite: ${danglingBefore.size}`);
  await mkdir(suiteRoot, { mode: 0o700 });
  await mkdir(join(suiteRoot, 'backups'), { mode: 0o700 });
  backupRoot = await realpath(join(suiteRoot, 'backups'));
  const installed = await buildFixture();
  await writeFixtureFiles();
  composeCreated = true;
  await dockerSuccess(compose(['up', '-d', '--wait']), { env: dockerEnvironment(), timeoutMs: 180_000 });
  await sql([
    'create table site_settings (id int primary key)', 'create table posts (id serial primary key, title text not null)',
    'create table pages (id int primary key)', 'create table media_items (id int primary key)',
    'insert into site_settings values (1)', "insert into posts (title) values ('First'), ('Second')",
    'insert into pages values (1)', 'insert into media_items values (1)',
  ].join('; '));
  await putObject('the original object');
  let backup!: BackupManifest & { directory: string };

  await t.test('a full backup, a row inserted, then a restore of that backup: the row is gone', async () => {
    const scenario = await createScenario(installed);
    try {
      const taken = await runJob(scenario, '/v1/backup', { requestId: randomUUID(), kind: 'full' });
      assert.equal(taken.phase, 'succeeded', `${JSON.stringify(taken)} ${scenario.errors.join('; ')}`);
      const directory = taken.backupDirectory as string;
      backup = { ...await readManifest(directory), directory };
      assert.deepEqual(backup.records, await counts(), 'the manifest counts the real rows');
      assert.equal((await readFile(join(directory, 'database.dump'))).subarray(0, 5).toString(), 'PGDMP', 'a real pg_dump');
      assert.deepEqual(backup.objects.map((object) => object.key), [objectKey]);

      await sql("insert into posts (title) values ('after the backup')");
      await putObject('changed after the backup');
      scenario.stopCount = 0;
      const statusBefore = await getUpdaterStatus({ socketPath: scenario.config.socketPath });
      const restore = await runJob(scenario, '/v1/restore', { requestId: randomUUID(), backupDirectory: directory });
      assert.equal(restore.phase, 'succeeded', `${JSON.stringify(restore)} ${scenario.errors.join('; ')}`);

      assert.equal(await sql("select count(*) from posts where title = 'after the backup'"), '0');
      assert.deepEqual(await counts(), backup.records);
      assert.equal(await readObject(), 'the original object');
      const record = JSON.parse(await readFile(join(scenario.config.stateDirectory, 'restore-job.json'), 'utf8')) as RestoreJob;
      assert.equal(record.phase, 'succeeded');
      assert.equal(record.errorCode, null);
      assert.equal(record.maintenanceKept, false);
      assert.deepEqual(record.report, { records: backup.records, sealedSecrets: 0, unopenedSecrets: [] });
      assert.ok(record.safetyBackupDirectory);
      assert.ok(scenario.stopCount >= 1, 'the app was stopped for the safety backup');
      await assertReady();
      await assertMarkerCleared(scenario, statusBefore);
    } finally { await closeServer(scenario.server); }
  });

  await t.test('FIXTURE_FAIL_STEP=restore-objects: the safety backup is put back, and the site comes out of maintenance', async (st) => {
    assert.ok(backup, 'needs the backup scenario 1 takes');
    const journal: string[] = [];
    st.mock.method(console, 'error', (line: unknown) => { journal.push(String(line)); });
    const scenario = await createScenario(installed);
    try {
      await sql("insert into posts (title) values ('kept by the safety backup')");
      await putObject('kept by the safety backup');
      const before = await counts();
      const statusBefore = await getUpdaterStatus({ socketPath: scenario.config.socketPath });
      // Only the restore of this backup fails: the rollback runs the same step on the safety backup.
      await writeEnvironment(`restore-objects:${basename(backup.directory)}`);
      let restore: Record<string, unknown>;
      try {
        restore = await runJob(scenario, '/v1/restore', { requestId: randomUUID(), backupDirectory: backup.directory });
      } finally { await writeEnvironment(); }
      assert.equal(restore.phase, 'failed', scenario.errors.join('; '));
      assert.equal(restore.errorCode, 'restore_failed');
      assert.equal(restore.maintenanceKept, false);
      assert.equal(await sql("select count(*) from posts where title = 'kept by the safety backup'"), '1');
      const safety = await readManifest(restore.safetyBackupDirectory as string);
      assert.deepEqual(await counts(), safety.records);
      assert.deepEqual(safety.records, before);
      assert.equal(await readObject(), 'kept by the safety backup');
      // The injected failure is what stopped it, and the updater journalled it.
      assert.deepEqual(journal.map((line) => JSON.parse(line)).filter(({ event }) => event === 'updater_command_failed').map(({ event, stage, exitCode, stdout }) => ({ event, stage, exitCode, stdout })), [{
        event: 'updater_command_failed', stage: 'restore.objects', exitCode: 1, stdout: '{"ok":false,"code":"injected"}\n',
      }]);
      await assertReady();
      await assertMarkerCleared(scenario, statusBefore);
    } finally { await closeServer(scenario.server); }
  });

  await t.test('the updater dies while restoring: on boot the safety backup is put back, out of maintenance', async () => {
    assert.ok(backup, 'needs the backup scenario 1 takes');
    const dump = `/work/${basename(backup.directory)}/database.dump`;
    const scenario = await createScenario(installed, { dieAfter: (args) => args.includes('restore-database') && args.includes(dump) });
    await sql("insert into posts (title) values ('back after the restart')");
    await putObject('back after the restart');
    const before = await counts();
    const statusBefore = await getUpdaterStatus({ socketPath: scenario.config.socketPath });
    assert.equal((await socketJson(scenario.config.socketPath, 'POST', '/v1/restore', {
      requestId: randomUUID(), backupDirectory: backup.directory,
    })).status, 202);
    for (let attempt = 0; attempt < 4800 && !scenario.died; attempt += 1) await delay(25);
    assert.ok(scenario.died, scenario.errors.join('; '));
    assert.equal((await scenario.state.readRestore())?.phase, 'restoring');
    assert.equal(await sql("select count(*) from posts where title = 'back after the restart'"), '0', 'the database is half restored');
    assert.equal(JSON.parse(await readFile(scenario.config.statusPath, 'utf8')).job?.phase, 'migrating', 'the site is in maintenance');
    assert.equal((await dockerSuccess(compose(['ps', '--quiet', 'app']), { env: dockerEnvironment(), timeoutMs: 30_000 })).stdout.trim(), '',
      'and the app is stopped');
    await closeServer(scenario.server);

    const revived = await createScenario(installed, { root: scenario.root });
    try {
      assert.equal(revived.booted?.phase, 'failed', revived.errors.join('; '));
      assert.equal(revived.booted?.errorCode, 'interrupted');
      assert.equal(revived.booted?.maintenanceKept, false);
      assert.equal(await sql("select count(*) from posts where title = 'back after the restart'"), '1');
      assert.deepEqual(await counts(), before);
      assert.deepEqual(await counts(), (await readManifest(revived.booted.safetyBackupDirectory!)).records);
      assert.equal(await readObject(), 'back after the restart');
      await assertReady();
      await assertMarkerCleared(revived, statusBefore);
    } finally { await closeServer(revived.server); }
  });

  await t.test('a backup of another site is refused before anything stops', async () => {
    assert.ok(backup, 'needs the backup scenario 1 takes');
    const scenario = await createScenario(installed);
    try {
      const other = join(backupRoot, 'another-site');
      await cp(backup.directory, other, { recursive: true });
      const manifest = JSON.parse(await readFile(join(other, 'manifest.json'), 'utf8'));
      await writeFile(join(other, 'manifest.json'), `${JSON.stringify({ ...manifest, config: { ...manifest.config, publicUrl: 'https://another.example.test' } })}\n`);
      const appBefore = await appContainer();
      const statusBefore = await getUpdaterStatus({ socketPath: scenario.config.socketPath });
      const restore = await runJob(scenario, '/v1/restore', { requestId: randomUUID(), backupDirectory: other });
      assert.equal(restore.phase, 'failed', scenario.errors.join('; '));
      assert.equal(restore.errorCode, 'backup_other_site');
      assert.equal(restore.safetyBackupDirectory, null);
      assert.equal(scenario.stopCount, 0);
      assert.deepEqual(await appContainer(), appBefore, 'the same app container, never restarted');
      await assertMarkerCleared(scenario, statusBefore);
    } finally { await closeServer(scenario.server); }
  });

  await t.test('an exited one-off beside a stopped app does not block a restore', async () => {
    assert.ok(backup, 'needs the backup scenario 1 takes');
    const leftover = `${projectName}-update-${randomUUID()}-leftover`;
    try {
      // What a CLI that died without its --rm leaves: an exited `compose run` container.
      await dockerSuccess(compose(['run', '-T', '--name', leftover, '--no-deps', '--entrypoint', 'true', 'app']), {
        env: dockerEnvironment(), timeoutMs: 60_000,
      });
      await dockerSuccess(compose(['stop', 'app']), { env: dockerEnvironment(), timeoutMs: 60_000 });
      // Compose lists the one-off with the app's own container, both exited; only its label tells them apart.
      const listed = lines((await dockerSuccess(compose(['ps', '--all', '--quiet', 'app']), { env: dockerEnvironment(), timeoutMs: 30_000 })).stdout);
      for (const id of listed) ownedContainerIds.add(id);
      const inspected = JSON.parse((await dockerSuccess(['inspect', '--type', 'container', ...listed], { timeoutMs: 30_000 })).stdout) as Array<{
        Name: string; State: { Status: string }; Config: { Labels: Record<string, string> };
        HostConfig: { Tmpfs: Record<string, string> | null }; Mounts: Array<{ Type: string }>;
      }>;
      assert.deepEqual(inspected.map((container) => [container.Name.slice(1) === leftover, container.State.Status,
        container.Config.Labels['com.docker.compose.oneoff']]).sort(), [[false, 'exited', 'False'], [true, 'exited', 'True']]);
      // A one-off inherits the service's tmpfs, so neither has a volume of its own.
      for (const container of inspected) {
        assert.deepEqual(Object.keys(container.HostConfig.Tmpfs ?? {}), ['/var/lib/postgresql/data']);
        assert.deepEqual(container.Mounts.filter((mount) => mount.Type === 'volume'), []);
      }

      const scenario = await createScenario(installed);
      try {
        const restore = await runJob(scenario, '/v1/restore', { requestId: randomUUID(), backupDirectory: backup.directory });
        assert.equal(restore.phase, 'succeeded', `${JSON.stringify(restore)} ${scenario.errors.join('; ')}`);
        assert.equal(restore.maintenanceKept, false);
        assert.deepEqual(await counts(), backup.records);
        await assertReady();
      } finally { await closeServer(scenario.server); }
    } finally {
      await dockerChecked(['rm', '--force', '--volumes', leftover], { allowFailure: true, timeoutMs: 30_000 });
    }
  });
});

interface Scenario {
  root: string;
  config: UpdaterConfig;
  state: ReturnType<typeof createUpdaterStateStore>;
  server: Server;
  errors: string[];
  stopCount: number;
  /** The updater "died": a command it ran never returned. */
  died: boolean;
  /** What boot reconciliation made of the restore record, as main.ts runs it before it listens. */
  booted: RestoreJob | null;
}
interface ResourceInventory { containers: string[]; networks: string[]; volumes: string[]; images: string[] }

async function buildFixture(): Promise<InstalledState> {
  const fixtureRoot = join(suiteRoot, 'app-fixture');
  await mkdir(fixtureRoot, { mode: 0o700 });
  await writeFile(join(fixtureRoot, 'main.go'), await fixtureSource());
  await writeFile(join(fixtureRoot, 'Dockerfile'), [
    'FROM postgres:17-alpine', 'ARG VERSION', 'COPY fixture /fixture',
    'LABEL org.opencontainers.image.version=${VERSION}', 'ENTRYPOINT ["/fixture"]', 'CMD []', '',
  ].join('\n'));
  const architecture = (await dockerSuccess(['info', '--format', '{{.Architecture}}'], { timeoutMs: 30_000 })).stdout.trim();
  const goArchitecture = architecture === 'aarch64' || architecture === 'arm64' ? 'arm64' :
    architecture === 'x86_64' || architecture === 'amd64' ? 'amd64' : '';
  assert.ok(goArchitecture, `Unsupported Docker architecture: ${architecture}`);
  const compiled = await runProcess('go', ['build', '-trimpath', '-ldflags', '-s -w -X main.version=1.13.0', '-o', 'fixture', 'main.go'], {
    cwd: fixtureRoot, env: { ...process.env, CGO_ENABLED: '0', GOOS: 'linux', GOARCH: goArchitecture }, timeoutMs: 120_000,
  });
  assert.equal(compiled.code, 0, compiled.stderr);
  await dockerSuccess(['build', '--label', `tomecms.test.project=${projectName}`, '--build-arg', 'VERSION=1.13.0', '-t', imageTag, fixtureRoot], {
    timeoutMs: 180_000,
  });
  const id = (await dockerSuccess(['image', 'inspect', '--format', '{{.Id}}', imageTag], { timeoutMs: 30_000 })).stdout.trim();
  assertImageId(id);
  ownedImageIds.add(id);
  fixtureImageId = id;
  fixtureAppPort = await freePort();
  return {
    version: '1.13.0', imageDigest: id, composeContract: 1, environmentContract: 1, updaterProtocol: 1,
    installedAt: '2026-10-03T09:00:00.000Z',
  };
}

async function writeFixtureFiles(): Promise<void> {
  await writeFile(join(suiteRoot, 'seaweedfs-s3.json'), JSON.stringify({ identities: [{ name: 'anonymous', actions: ['Read'] }] }));
  await writeEnvironment();
  await writeFile(baseImageEnvironmentFile, imageEnvironment(fixtureImageId!), { mode: 0o600 });
  await writeFile(composeFile, `services:
  postgres:
    image: postgres:17-alpine
    labels: { tomecms.test.project: "${projectName}" }
    environment:
      POSTGRES_DB: fixture
      POSTGRES_USER: fixture
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U fixture -d fixture"]
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
      PGHOST: postgres
      PGUSER: fixture
      PGDATABASE: fixture
      PGPASSWORD: \${POSTGRES_PASSWORD}
      S3_BUCKET: \${S3_BUCKET}
      S3_ACCESS_KEY_ID: \${S3_ACCESS_KEY_ID}
      S3_SECRET_ACCESS_KEY: \${S3_SECRET_ACCESS_KEY}
      TOME_CMS_PUBLIC_URL: \${TOME_CMS_PUBLIC_URL}
      FIXTURE_FAIL_STEP: \${TOME_CMS_FIXTURE_FAIL_STEP:-}
    depends_on:
      postgres: { condition: service_healthy }
      seaweedfs: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "/fixture", "healthcheck"]
      interval: 500ms
      timeout: 2s
      retries: 20
    ports: ["127.0.0.1:\${APP_PORT}:4321"]
    # postgres:17-alpine declares VOLUME /var/lib/postgresql/data. A tmpfs there keeps every
    # container of this service, compose run one-shots included, from making an anonymous volume.
    tmpfs: ["/var/lib/postgresql/data"]
volumes:
  postgres-data:
    labels: { tomecms.test.project: "${projectName}" }
  seaweedfs-data:
    labels: { tomecms.test.project: "${projectName}" }
configs:
  seaweedfs-s3-config:
    file: ./seaweedfs-s3.json
`);
}

/** The managed env file. `failStep` makes the fixture's content step of that name (`step` or `step:<backup>`) fail. */
async function writeEnvironment(failStep = ''): Promise<void> {
  await writeFile(environmentFile, [
    `APP_PORT='${fixtureAppPort}'`, `POSTGRES_PASSWORD='${fixtureInterpolation.POSTGRES_PASSWORD}'`,
    `S3_BUCKET='${fixtureInterpolation.S3_BUCKET}'`, `S3_ACCESS_KEY_ID='${fixtureInterpolation.S3_ACCESS_KEY_ID}'`,
    `S3_SECRET_ACCESS_KEY='${fixtureInterpolation.S3_SECRET_ACCESS_KEY}'`, `TOME_CMS_PUBLIC_URL='${publicUrl}'`,
    `TOME_CMS_FIXTURE_FAIL_STEP='${failStep}'`, '',
  ].join('\n'), { mode: 0o600 });
}

async function createScenario(
  installed: InstalledState, options: { root?: string; dieAfter?: (args: readonly string[]) => boolean } = {},
): Promise<Scenario> {
  const root = options.root ?? join(suiteRoot, `case-${randomUUID()}`);
  const stateDirectory = join(root, 'state');
  const config: UpdaterConfig = {
    configVersion: 1, projectName, composeFile, environmentFile, imageEnvironmentFile: join(stateDirectory, 'image.env'),
    stateDirectory, backupDirectory: backupRoot, socketPath: join(suiteRoot, `${randomUUID().slice(0, 6)}.sock`),
    statusPath: join(root, 'status.json'), appHealthUrl: `http://127.0.0.1:${fixtureAppPort}/health/ready`, minimumFreeBytes: 1,
  };
  assert.ok(Buffer.byteLength(config.socketPath) < 104, 'Fixture socket path must fit macOS sockaddr_un');
  const state = createUpdaterStateStore(config);
  if (!options.root) {
    await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
    await writeFile(config.imageEnvironmentFile, imageEnvironment(installed.imageDigest), { mode: 0o600 });
    await state.writeInstalled(installed);
  }
  const scenario: Scenario = {
    root, config, state, server: undefined as unknown as Server, errors: [], stopCount: 0, died: false, booted: null,
  };
  const runCommand: UpdateDependencies['runCommand'] = async (executable, args, commandOptions) => {
    assert.equal(executable, 'docker');
    const action = composeAction(args);
    if (action === 'stop') scenario.stopCount += 1;
    // As the real runCommand: a command that fails answers its exit code, and the updater decides.
    let result = await dockerChecked(args, { allowFailure: true, env: dockerEnvironment(), timeoutMs: commandOptions.timeoutMs });
    if (result.code !== 0) scenario.errors.push(`${action ?? args[0]} ${args.at(-1)}: ${result.code} ${result.stdout} ${result.stderr}`);
    if (result.code === 0 && action === 'ps' && args.at(-1) === 'app') for (const id of lines(result.stdout)) ownedContainerIds.add(id);
    if (result.code === 0 && args[0] === 'inspect') result = asOfficialImage(result);
    if (options.dieAfter?.(args)) {
      scenario.died = true;
      return new Promise<CommandResult>(() => undefined);
    }
    return result;
  };
  const dependencies: UpdateDependencies = { ...defaults, runCommand, sleep: async () => undefined };
  // The boot order of src/updater/main.ts: reconcile, then serve.
  scenario.booted = await reconcileRestore({ config, state, dependencies });
  const server = createUpdaterServer({
    state,
    apply: async () => { throw new Error('The restore harness applies no update'); },
    backup: { check: () => assertBackupSpace(config, statfs), run: (job) => runBackup({ backup: job, config, dependencies, state }) },
    restore: { check: () => assertBackupSpace(config, statfs), run: (job) => runRestore({ restore: job, config, dependencies, state }) },
  });
  scenario.server = server;
  servers.add(server);
  server.listen(config.socketPath);
  await once(server, 'listening');
  return scenario;
}

/** Starts a backup or a restore through the socket, as `tome` does, and waits for its end. */
async function runJob(scenario: Scenario, path: '/v1/backup' | '/v1/restore', body: unknown): Promise<Record<string, unknown>> {
  const started = await socketJson(scenario.config.socketPath, 'POST', path, body);
  assert.equal(started.status, 202, JSON.stringify(started.json));
  for (let attempt = 0; attempt < 4800; attempt += 1) {
    await delay(25);
    const job = (await socketJson(scenario.config.socketPath, 'GET', path)).json as Record<string, unknown>;
    if (job.phase === 'succeeded' || job.phase === 'failed') return job;
  }
  throw new Error(`${path} did not finish: ${scenario.errors.join('; ')}`);
}

async function readManifest(directory: string): Promise<BackupManifest> {
  return parseBackupManifest(JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')));
}

async function sql(query: string): Promise<string> {
  const result = await dockerSuccess(compose(['exec', '-T', 'postgres', 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At',
    '-U', 'fixture', '-d', 'fixture', '-c', query]), { env: dockerEnvironment(), timeoutMs: 30_000 });
  return result.stdout.trim();
}

async function counts(): Promise<unknown> { return JSON.parse(await sql(countsQuery)); }

/** The one object, written through SeaweedFS's S3 API with the fixture's keys. */
async function putObject(text: string): Promise<void> {
  await dockerSuccess(compose(['exec', '-T', 'seaweedfs', 'curl', '-sS', '--fail', '-X', 'PUT', '--aws-sigv4', 'aws:amz:us-east-1:s3',
    '--user', `${fixtureInterpolation.S3_ACCESS_KEY_ID}:${fixtureInterpolation.S3_SECRET_ACCESS_KEY}`,
    '-H', 'content-type: image/webp', '--data-binary', text,
    `http://127.0.0.1:8333/${fixtureInterpolation.S3_BUCKET}/${objectKey}`]), { env: dockerEnvironment(), timeoutMs: 30_000 });
}

async function readObject(): Promise<string> {
  return (await dockerSuccess(compose(['exec', '-T', 'seaweedfs', 'curl', '-sS', '--fail',
    `http://127.0.0.1:8333/${fixtureInterpolation.S3_BUCKET}/${objectKey}`]), { env: dockerEnvironment(), timeoutMs: 30_000 })).stdout;
}

async function appContainer(): Promise<{ id: string; startedAt: string; running: boolean }> {
  const id = (await dockerSuccess(compose(['ps', '--quiet', 'app']), { env: dockerEnvironment(), timeoutMs: 30_000 })).stdout.trim();
  assert.match(id, /^[0-9a-f]{64}$/);
  ownedContainerIds.add(id);
  const [startedAt, running] = (await dockerSuccess(['inspect', '--type', 'container', '--format', '{{.State.StartedAt}} {{.State.Running}}', id], {
    timeoutMs: 30_000,
  })).stdout.trim().split(' ');
  return { id, startedAt: startedAt!, running: running === 'true' };
}

async function assertReady(): Promise<void> {
  assert.equal((await fetch(`http://127.0.0.1:${fixtureAppPort}/health/ready`)).ok, true, 'the site is ready');
}

/** The marker ends as the status says when no job holds the site in maintenance. */
async function assertMarkerCleared(scenario: Scenario, expected: UpdaterStatus): Promise<void> {
  let marker: unknown;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    marker = await readFile(scenario.config.statusPath, 'utf8').then(JSON.parse, () => undefined);
    if (isDeepStrictEqual(marker, expected)) break;
    await delay(25);
  }
  assert.deepEqual(marker, expected, 'the marker is cleared');
}

/** The fixture image by the name the updater expects of an installed image: the official repository at its digest. */
function asOfficialImage(result: CommandResult): CommandResult {
  const containers = JSON.parse(result.stdout) as Array<{ Config?: { Image?: string } }>;
  return { ...result, stdout: JSON.stringify(containers.map((container) => container.Config?.Image === fixtureImageId ?
    { ...container, Config: { ...container.Config, Image: `${OFFICIAL_IMAGE_REPOSITORY}@${fixtureImageId}` } } : container)) };
}

function compose(tail: readonly string[]): string[] {
  return ['compose', '-p', projectName, '-f', composeFile, '--env-file', environmentFile, '--env-file', baseImageEnvironmentFile, ...tail];
}

function composeAction(args: readonly string[]): string | undefined {
  return args.find((value) => ['stop', 'run', 'up', 'ps', 'exec', 'down'].includes(value));
}

function dockerEnvironment(): NodeJS.ProcessEnv {
  assert.ok(fixtureAppPort !== null && fixtureImageId !== null, 'The fixture is not built');
  return { ...process.env, APP_PORT: String(fixtureAppPort), ...fixtureInterpolation, TOME_CMS_APP_IMAGE: fixtureImageId };
}

function imageEnvironment(digest: string): string {
  assertImageId(digest);
  return `TOME_CMS_APP_IMAGE='${OFFICIAL_IMAGE_REPOSITORY}@${digest}'\n`;
}

// Copied from tests/operations/managed-update.test.ts, from dockerSuccess to freePort, with
// assertSafeScope's prefix, assertDockerScope's single image tag and its several-id inspect adapted.
// These guards keep a test off a real install: keep the two files in step.
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
  if (!options.allowFailure && result.code !== 0) throw new Error(`Guarded Docker command failed (${result.code}): ${result.stderr} ${result.stdout}`);
  return result;
}

function assertDockerScope(args: readonly string[]): void {
  const text = args.join(' ');
  if (args.includes('tomecms') || text.includes('/opt/tome-cms') || text.includes('/etc/tome-cms') ||
    text.includes('/var/lib/tome-cms') || text.includes('/var/backups/tome-cms') ||
    args.some((value) => /^tome-cms(?:-|_|$)/.test(value))) throw new Error('Unsafe Docker scope');
  if (args[0] === 'info') return;
  if (args[0] === 'compose') {
    assert.equal(args[args.indexOf('-p') + 1], projectName, 'Unsafe Compose project');
    assert.equal(resolve(args[args.indexOf('-f') + 1] ?? ''), composeFile, 'Unsafe Compose file');
    for (let index = 0; index < args.length; index += 1) if (args[index] === '--env-file') assertSafePath(args[index + 1] ?? '');
    return;
  }
  if (args[0] === 'build') {
    assert.equal(args[args.indexOf('-t') + 1], imageTag);
    assert.equal(args[args.indexOf('--label') + 1], `tomecms.test.project=${projectName}`);
    assertSafePath(args.at(-1) ?? '');
    return;
  }
  if (args[0] === 'image' && args[1] === 'inspect') return assert.equal(args.at(-1), imageTag);
  if (args[0] === 'image' && args[1] === 'rm') {
    const target = args.at(-1) ?? '';
    assert.ok(target === imageTag || ownedImageIds.has(target));
    return;
  }
  if (args[0] === 'image' && args[1] === 'ls') return assert.ok(args.includes(`label=tomecms.test.project=${projectName}`));
  if (args[0] === 'inspect') {
    const targets = args.filter((value) => /^[0-9a-f]{64}$/.test(value));
    assert.ok(targets.length > 0 && targets.every((target) => ownedContainerIds.has(target)), 'Unsafe container inspection');
    return;
  }
  if (args[0] === 'ps') return assert.ok(args.some((value) => value.includes(projectName)), 'Unsafe container listing');
  if (args[0] === 'rm') return assert.ok(args.at(-1)?.startsWith(`${projectName}-update-`), 'Unsafe container removal');
  // Read-only, and only to find what this suite left behind.
  if (args.join(' ') === 'volume ls -q --filter dangling=true') return;
  if ((args[0] === 'network' || args[0] === 'volume') && args[1] === 'ls') {
    assert.ok(args.some((value) => value.includes(projectName)), 'Unsafe resource listing');
    return;
  }
  throw new Error(`Unsafe or unsupported Docker command: ${text}`);
}

async function danglingVolumes(): Promise<string[]> {
  return lines((await dockerSuccess(['volume', 'ls', '-q', '--filter', 'dangling=true'], { timeoutMs: 30_000 })).stdout);
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
  const tail = relative(resolve(tmpdir()), resolve(root));
  if (!tail.split(sep)[0]?.startsWith('tomecms-test-managed-restore-') || tail.startsWith(`..${sep}`)) throw new Error('Unsafe test root path');
}

function assertSafePath(path: string): void {
  const tail = relative(suiteRoot, resolve(path));
  if (tail === '..' || isAbsolute(tail) || tail.startsWith(`..${sep}`)) throw new Error('Unsafe test path');
}

function lines(output: string): string[] { return output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).sort(); }
function assertImageId(value: string): asserts value is `sha256:${string}` { assert.match(value, /^sha256:[0-9a-f]{64}$/); }
function asError(value: unknown): Error { return value instanceof Error ? value : new Error(String(value)); }
function delay(milliseconds: number): Promise<void> { return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds)); }

/** One JSON request to the updater's socket, as `tome` makes it. */
function socketJson(socketPath: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolveRequest, reject) => {
    const outgoing = httpRequest({ socketPath, method, path, headers: payload === undefined ? {} : {
      'content-type': 'application/json', 'content-length': Buffer.byteLength(payload),
    } }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolveRequest({ status: response.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    outgoing.on('error', reject);
    outgoing.end(payload);
  });
}

async function closeServer(server: Server): Promise<void> {
  servers.delete(server);
  if (!server.listening) return;
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
}

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

// The app: serves readiness, takes the offline backup with pg_dump and the S3 API, and runs the
// content CLI's three restore steps with pg_restore, the S3 API and psql. It panics on any other argv.
// Its two constants are this file's own, filled in where the fixture names them: keep them in step.
async function fixtureSource(): Promise<string> {
  const source = await readFile(new URL('./fixtures/managed-restore-app.go', import.meta.url), 'utf8');
  const filled = source.replace('"{{objectKey}}"', JSON.stringify(objectKey)).replace('"{{countsQuery}}"', JSON.stringify(countsQuery));
  assert.ok(!filled.includes('{{'), 'every placeholder in the fixture is filled');
  return filled;
}
