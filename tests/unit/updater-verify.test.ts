import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  OFFICIAL_IMAGE_REPOSITORY,
  OFFICIAL_REPOSITORY,
  UPDATE_IMAGE_ATTESTATION_ASSET,
  type UpdateManifest,
  UPDATE_MANIFEST_ATTESTATION_ASSET,
} from '../../src/update/contracts.js';
import type { UpdaterConfig } from '../../src/updater/config.js';
import type { CommandDiagnosticContext, CommandResult } from '../../src/updater/process.js';
import type { InstalledState } from '../../src/updater/state.js';
import { runPreflight, verifyTargetRelease, type VerifyDependencies } from '../../src/updater/verify.js';

const installed: InstalledState = {
  version: '1.0.0',
  imageDigest: `sha256:${'a'.repeat(64)}`,
  composeContract: 1,
  environmentContract: 1,
  updaterProtocol: 1,
  installedAt: '2026-09-20T09:00:00.000Z',
};

const manifest: UpdateManifest = {
  format: 'tomecms-update', manifestVersion: 1, product: 'tomecms', channel: 'stable',
  version: '1.0.1', releasedAt: '2026-09-20T10:00:00.000Z',
  source: { repository: OFFICIAL_REPOSITORY, commit: '0'.repeat(40) },
  image: {
    repository: OFFICIAL_IMAGE_REPOSITORY,
    digest: `sha256:${'b'.repeat(64)}`,
    platforms: ['linux/amd64', 'linux/arm64'],
  },
  compatibility: {
    minimumDirectUpgradeFrom: '1.0.0', minimumUpdaterVersion: '1.0.0',
    targetMigration: '008_update_rate_limit_actions', rollbackSafeFrom: '1.0.0',
    composeContract: 1, environmentContract: 1, updaterProtocol: 1,
  },
  releaseNotesUrl: 'https://github.com/Dhanabhon/tome-cms/releases/tag/v1.0.1',
};

async function hostFixture() {
  const root = await mkdtemp(join(tmpdir(), 'tomecms-updater-verify-'));
  const stateDirectory = join(root, 'state');
  const backupDirectory = join(root, 'backups');
  const composeFile = join(root, 'compose.managed.yaml');
  const environmentFile = join(root, 'tome-cms.env');
  const imageEnvironmentFile = join(stateDirectory, 'image.env');
  await mkdir(stateDirectory);
  await mkdir(backupDirectory);
  await writeFile(composeFile, 'services: {}\n');
  await writeFile(environmentFile, 'TOME_CMS_UPDATE_MODE=managed\n');
  await writeFile(imageEnvironmentFile, `TOME_CMS_APP_IMAGE='${OFFICIAL_IMAGE_REPOSITORY}@${installed.imageDigest}'\n`);
  return {
    root,
    config: {
      configVersion: 1,
      projectName: 'tomecms',
      composeFile,
      environmentFile,
      imageEnvironmentFile,
      stateDirectory,
      backupDirectory,
      socketPath: join(root, 'updater.sock'),
      statusPath: join(root, 'status.json'),
      appHealthUrl: 'http://127.0.0.1:4321/health/ready',
      minimumFreeBytes: 5 * 1024 ** 3,
    } satisfies UpdaterConfig,
  };
}

function commandResult(code = 0, stdout = ''): CommandResult {
  return { code, stdout, stderr: code === 0 ? '' : 'failed' };
}

function composeHealth(): string {
  return [
    { Service: 'app', State: 'running', Health: 'healthy' },
    { Service: 'postgres', State: 'running', Health: 'healthy' },
    { Service: 'seaweedfs', State: 'running', Health: 'healthy' },
  ].map((record) => JSON.stringify(record)).join('\n');
}

function releaseFor(value: unknown, override: Record<string, unknown> = {}) {
  const bytes = Buffer.from(JSON.stringify(value));
  const manifestBundleBytes = Buffer.from('manifest-attestation-bundle');
  const imageBundleBytes = Buffer.from('image-attestation-bundle');
  const version = typeof value === 'object' && value !== null && 'version' in value &&
    typeof value.version === 'string' ? value.version : '1.0.1';
  const asset = (name: string, body: Uint8Array) => ({
    name,
    browser_download_url: `https://github.com/Dhanabhon/tome-cms/releases/download/v${version}/${name}`,
    digest: `sha256:${createHash('sha256').update(body).digest('hex')}`,
  });
  return {
    bytes, manifestBundleBytes, imageBundleBytes,
    release: {
      tag_name: `v${version}`, draft: false, prerelease: false, immutable: true,
      published_at: '2026-09-20T10:01:00.000Z',
      html_url: `https://github.com/Dhanabhon/tome-cms/releases/tag/v${version}`,
      assets: [
        asset('update-manifest.json', bytes),
        asset(UPDATE_MANIFEST_ATTESTATION_ASSET, manifestBundleBytes),
        asset(UPDATE_IMAGE_ATTESTATION_ASSET, imageBundleBytes),
      ],
      ...override,
    },
  };
}

function dependencies(input: {
  value?: unknown;
  release?: Record<string, unknown>;
  events?: string[];
  commandFailure?: 'manifest' | 'image';
  availableBytes?: number;
  platform?: string;
  manifestBytes?: Uint8Array;
  downloads?: Record<string, Uint8Array>;
} = {}): VerifyDependencies {
  const events = input.events ?? [];
  const fixture = releaseFor(input.value ?? manifest);
  const release = input.release ?? fixture.release;
  const manifestBytes = input.manifestBytes ?? fixture.bytes;
  const downloads: Record<string, Uint8Array> = {
    'update-manifest.json': manifestBytes,
    [UPDATE_MANIFEST_ATTESTATION_ASSET]: fixture.manifestBundleBytes,
    [UPDATE_IMAGE_ATTESTATION_ASSET]: fixture.imageBundleBytes,
    ...input.downloads,
  };
  return {
    fetcher: async (request, init) => {
      const url = String(request);
      assert.ok(init?.signal);
      if (url.startsWith('https://')) {
        assert.equal(new Headers(init?.headers).get('accept'), 'application/vnd.github+json');
        assert.equal(new Headers(init?.headers).get('x-github-api-version'), '2022-11-28');
      }
      if (url.includes('/releases/tags/')) {
        events.push(`github:release:${url.split('/').at(-1)}`);
        return Response.json(release);
      }
      if (url.includes('/releases/download/')) {
        const name = url.split('/').at(-1)!;
        events.push(`github:${name}`);
        const body = downloads[name];
        if (!body) throw new Error(`Unexpected download: ${name}`);
        return new Response(Buffer.from(body));
      }
      if (url === 'http://127.0.0.1:4321/health/ready') {
        events.push('health');
        return new Response('ready');
      }
      throw new Error(`Unexpected fetch: ${url}`);
    },
    runCommand: async (executable, args, options) => {
      assert.ok(options.timeoutMs > 0);
      if (executable === 'gh' && args[0] === 'attestation') {
        const image = args[2]?.startsWith('oci://');
        events.push(image ? 'gh:image-attestation' : 'gh:manifest-attestation');
        if (input.commandFailure === (image ? 'image' : 'manifest')) return commandResult(1);
        return commandResult();
      }
      if (executable === 'docker' && args.includes('ps')) return commandResult(0, composeHealth());
      return commandResult();
    },
    statfs: (async () => {
      events.push('disk');
      return { bsize: 1, bavail: input.availableBytes ?? 6 * 1024 ** 3 };
    }) as unknown as VerifyDependencies['statfs'],
    now: () => new Date('2026-09-20T11:00:00.000Z'),
    hostPlatform: () => {
      events.push('platform');
      return input.platform ?? 'linux/amd64';
    },
  };
}

test('verifies the exact immutable release, attestations, compatibility and preflight in order', async () => {
  const { root, config } = await hostFixture();
  const events: string[] = [];
  const privatePaths = new Set<string>();
  const ghDirectories = new Set<string>();
  const deps = dependencies({ events });
  const originalRun = deps.runCommand;
  deps.runCommand = async (executable, args, options) => {
    if (executable === 'gh') {
      assert.ok(options.env);
      for (const name of [
        'GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN',
        'GH_HOST', 'GITHUB_HOST', 'GH_ENTERPRISE_HOST', 'GITHUB_ENTERPRISE_HOST',
        'GITHUB_API_URL', 'GITHUB_GRAPHQL_URL', 'GITHUB_SERVER_URL', 'GH_REPO',
      ]) assert.equal(options.env[name], undefined);
      for (const name of ['GH_CONFIG_DIR', 'XDG_CACHE_HOME']) {
        const directory: string | undefined = options.env[name];
        if (typeof directory !== 'string') assert.fail(`${name} was not isolated`);
        assert.ok(directory.startsWith(`${config.stateDirectory}/`));
        assert.equal((await stat(directory)).mode & 0o777, 0o700);
        ghDirectories.add(directory);
      }

      if (args[0] === 'attestation') {
        const image = args[2]?.startsWith('oci://');
        const bundleIndex = args.indexOf('--bundle');
        assert.ok(bundleIndex > 0);
        const subject = args[2];
        const bundlePath = args[bundleIndex + 1];
        privatePaths.add(bundlePath);
        if (!image) privatePaths.add(subject);
        assert.deepEqual(args, [
          'attestation', 'verify', image
            ? `oci://${OFFICIAL_IMAGE_REPOSITORY}@${manifest.image.digest}`
            : subject,
          '--bundle', bundlePath,
          '-R', OFFICIAL_REPOSITORY,
          '--signer-workflow', 'Dhanabhon/tome-cms/.github/workflows/release.yml',
          '--source-ref', 'refs/tags/v1.0.1',
          '--source-digest', manifest.source.commit,
          '--deny-self-hosted-runners',
        ]);
        const expected = image ? releaseFor(manifest).imageBundleBytes : releaseFor(manifest).manifestBundleBytes;
        assert.deepEqual(await readFile(bundlePath), expected);
        if (!image) assert.deepEqual(await readFile(subject), releaseFor(manifest).bytes);
      }
    }
    return originalRun(executable, args, options);
  };

  const inherited = Object.fromEntries([
    'GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN',
    'GH_HOST', 'GITHUB_HOST', 'GH_ENTERPRISE_HOST', 'GITHUB_ENTERPRISE_HOST',
    'GITHUB_API_URL', 'GITHUB_GRAPHQL_URL', 'GITHUB_SERVER_URL', 'GH_REPO',
    'GH_CONFIG_DIR', 'XDG_CACHE_HOME',
  ].map((name) => [name, process.env[name]]));
  for (const name of Object.keys(inherited)) process.env[name] = 'attacker-controlled';
  try {
    const verified = await verifyTargetRelease({
      version: '1.0.1', installed, updaterVersion: '1.0.0', config, dependencies: deps,
    });
    assert.equal(verified.manifest.version, '1.0.1');
    assert.equal(verified.imageReference, `${OFFICIAL_IMAGE_REPOSITORY}@${manifest.image.digest}`);
    assert.deepEqual(events, [
      'github:release:v1.0.1', 'github:update-manifest.json',
      `github:${UPDATE_MANIFEST_ATTESTATION_ASSET}`, `github:${UPDATE_IMAGE_ATTESTATION_ASSET}`,
      'gh:manifest-attestation',
      'gh:image-attestation', 'health', 'disk', 'platform',
    ]);
    for (const path of [...privatePaths, ...ghDirectories]) await assert.rejects(stat(path), { code: 'ENOENT' });
  } finally {
    for (const [name, value] of Object.entries(inherited)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects missing, duplicate or redirected bundle assets before attestation', async () => {
  const { root, config } = await hostFixture();
  try {
    const fixture = releaseFor(manifest);
    const manifestBundle = fixture.release.assets.find((asset) => asset.name === UPDATE_MANIFEST_ATTESTATION_ASSET)!;
    const imageBundle = fixture.release.assets.find((asset) => asset.name === UPDATE_IMAGE_ATTESTATION_ASSET)!;
    for (const release of [
      { ...fixture.release, immutable: false },
      { ...fixture.release, assets: [...fixture.release.assets, { ...fixture.release.assets[0] }] },
      { ...fixture.release, assets: fixture.release.assets.filter((asset) => asset !== manifestBundle) },
      { ...fixture.release, assets: [...fixture.release.assets, { ...imageBundle }] },
      { ...fixture.release, assets: fixture.release.assets.map((asset) => asset === manifestBundle
        ? { ...asset, browser_download_url: `${asset.browser_download_url}?redirected=1` }
        : asset) },
      { ...fixture.release, assets: fixture.release.assets.map((asset) => asset === imageBundle
        ? { ...asset, digest: `sha512:${'f'.repeat(128)}` }
        : asset) },
    ]) {
      const events: string[] = [];
      await assert.rejects(verifyTargetRelease({
        version: '1.0.1', installed, updaterVersion: '1.0.0', config,
        dependencies: dependencies({ release, events }),
      }), /release/i);
      assert.equal(events.some((event) => event.startsWith('gh:')), false);
    }

    for (const assetWithDigest of [fixture.release.assets[0], manifestBundle, imageBundle]) {
      const events: string[] = [];
      await assert.rejects(verifyTargetRelease({
        version: '1.0.1', installed, updaterVersion: '1.0.0', config,
        dependencies: dependencies({
          release: {
            ...fixture.release,
            assets: fixture.release.assets.map((asset) => asset === assetWithDigest
              ? { ...asset, digest: `sha256:${'f'.repeat(64)}` }
              : asset),
          },
          events,
        }),
      }), /digest/i);
      assert.equal(events.some((event) => event.startsWith('gh:')), false);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('bounds release responses and validates the requested version before fetching', async () => {
  const { root, config } = await hostFixture();
  try {
    let calls = 0;
    const deps = dependencies();
    deps.fetcher = async () => {
      calls += 1;
      return new Response(' '.repeat(512 * 1024 + 1));
    };
    await assert.rejects(verifyTargetRelease({
      version: '1.0.1', installed, updaterVersion: '1.0.0', config, dependencies: deps,
    }), /too large/i);

    calls = 0;
    await assert.rejects(verifyTargetRelease({
      version: '1.0.1/../../latest', installed, updaterVersion: '1.0.0', config, dependencies: deps,
    }), /stable version/i);
    assert.equal(calls, 0);

    const bundleDeps = dependencies({
      downloads: { [UPDATE_MANIFEST_ATTESTATION_ASSET]: Buffer.alloc(512 * 1024 + 1) },
    });
    await assert.rejects(verifyTargetRelease({
      version: '1.0.1', installed, updaterVersion: '1.0.0', config, dependencies: bundleDeps,
    }), /too large/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('fails closed when either attestation fails and always removes its private manifest', async () => {
  const { root, config } = await hostFixture();
  try {
    for (const commandFailure of ['manifest', 'image'] as const) {
      const privatePaths = new Set<string>();
      const deps = dependencies({ commandFailure });
      const run = deps.runCommand;
      deps.runCommand = async (executable, args, options) => {
        if (executable === 'gh' && args[0] === 'attestation') {
          if (!args[2]?.startsWith('oci://')) privatePaths.add(args[2]);
          const bundleIndex = args.indexOf('--bundle');
          if (bundleIndex >= 0) privatePaths.add(args[bundleIndex + 1]);
        }
        return run(executable, args, options);
      };
      await assert.rejects(verifyTargetRelease({
        version: '1.0.1', installed, updaterVersion: '1.0.0', config, dependencies: deps,
      }), /attestation/i);
      assert.ok(privatePaths.size >= 2);
      for (const path of privatePaths) await assert.rejects(readFile(path), { code: 'ENOENT' });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('verifies both attestations before rejecting an incompatible direct upgrade', async () => {
  const { root, config } = await hostFixture();
  try {
    const cases: Array<{ value: unknown; version?: string; current?: InstalledState; updater?: string }> = [
      {
        value: { ...manifest, version: '1.0.0', releaseNotesUrl: 'https://github.com/Dhanabhon/tome-cms/releases/tag/v1.0.0' },
        version: '1.0.0',
      },
      { value: { ...manifest, compatibility: { ...manifest.compatibility, minimumDirectUpgradeFrom: '1.0.1' } } },
      { value: { ...manifest, compatibility: { ...manifest.compatibility, minimumUpdaterVersion: '1.0.1' } }, updater: '1.0.0' },
      { value: { ...manifest, compatibility: { ...manifest.compatibility, rollbackSafeFrom: '1.0.1' } } },
      { value: { ...manifest, compatibility: { ...manifest.compatibility, composeContract: 2 } } },
      { value: { ...manifest, compatibility: { ...manifest.compatibility, environmentContract: 2 } } },
      { value: { ...manifest, compatibility: { ...manifest.compatibility, updaterProtocol: 2 } } },
    ];
    for (const entry of cases) {
      const events: string[] = [];
      await assert.rejects(verifyTargetRelease({
        version: entry.version ?? '1.0.1', installed: entry.current ?? installed,
        updaterVersion: entry.updater ?? '1.0.0', config,
        dependencies: dependencies({ value: entry.value, events }),
      }), /compatib|version|upgrade|rollback|contract/i);
      assert.equal(events.includes('gh:image-attestation'), true);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('uses shared migration-key syntax validation without hard-coded migration membership', async () => {
  const { root, config } = await hostFixture();
  try {
    const arbitraryValidKey = {
      ...manifest,
      compatibility: { ...manifest.compatibility, targetMigration: '999_future_migration' },
    };
    assert.equal((await verifyTargetRelease({
      version: '1.0.1', installed, updaterVersion: '1.0.0', config,
      dependencies: dependencies({ value: arbitraryValidKey }),
    })).manifest.compatibility.targetMigration, '999_future_migration');

    const events: string[] = [];
    await assert.rejects(verifyTargetRelease({
      version: '1.0.1', installed, updaterVersion: '1.0.0', config,
      dependencies: dependencies({
        value: { ...manifest, compatibility: { ...manifest.compatibility, targetMigration: '../008' } },
        events,
      }),
    }), /manifest/i);
    assert.equal(events.includes('gh:image-attestation'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('preflight rejects unsupported platforms and insufficient disk without mutating Docker', async () => {
  const { root, config } = await hostFixture();
  try {
    for (const deps of [
      dependencies({ platform: 'linux/s390x' }),
      dependencies({ availableBytes: config.minimumFreeBytes - 1 }),
    ]) {
      const commands: string[][] = [];
      const run = deps.runCommand;
      deps.runCommand = async (executable, args, options) => {
        commands.push([executable, ...args]);
        return run(executable, args, options);
      };
      await assert.rejects(runPreflight({
        installed, target: manifest, updaterVersion: '1.0.0', config, dependencies: deps,
      }), /platform|disk/i);
      assert.equal(commands.some((command) => ['pull', 'stop', 'up', 'run'].some((word) => command.includes(word))), false);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('preflight uses fixed read-only command arguments and accepts healthy Compose NDJSON', async () => {
  const { root, config } = await hostFixture();
  try {
    const calls: Array<[string, readonly string[], number]> = [];
    const deps = dependencies();
    deps.runCommand = async (executable, args, options) => {
      calls.push([executable, args, options.timeoutMs]);
      return commandResult(0, args.includes('ps') ? composeHealth() : 'ok');
    };
    await runPreflight({ installed, target: manifest, updaterVersion: '1.0.0', config, dependencies: deps });
    assert.deepEqual(calls.map(([executable, args]) => [executable, ...args]), [
      ['docker', 'version'],
      ['docker', 'compose', 'version'],
      ['gh', 'version'],
      ['docker', 'compose', '-p', 'tomecms', '-f', config.composeFile,
        '--env-file', config.environmentFile, '--env-file', config.imageEnvironmentFile,
        'ps', '--format', 'json', 'app', 'postgres', 'seaweedfs'],
    ]);
    assert.ok(calls.every(([, , timeout]) => timeout > 0));

  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('journals bounded fixed stages for Docker preflight failures and timeouts', async (t) => {
  const { root, config } = await hostFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const secret = 'preflight-private-secret-value';
  const diagnostics: CommandDiagnosticContext = {
    jobId: '2cb65d31-2210-4cee-ab70-df64178948de', targetVersion: '1.0.1', secrets: [secret],
  };
  const originalError = console.error;
  try {
    for (const scenario of [
      { stage: 'verify.docker_engine', matches: (args: readonly string[]) => args[0] === 'version', result: commandResult(1) },
      { stage: 'verify.compose_cli', matches: (args: readonly string[]) => args[0] === 'compose' && args[1] === 'version',
        result: { code: 124, stdout: secret, stderr: encodeURIComponent(secret), timedOut: true, signal: 'SIGKILL' } },
      { stage: 'verify.compose_health', matches: (args: readonly string[]) => args.includes('ps'), result: commandResult(1, secret) },
    ] as const) {
      const messages: string[] = [];
      console.error = (message: unknown) => { messages.push(String(message)); };
      const deps = dependencies();
      const run = deps.runCommand;
      deps.runCommand = async (executable, args, options) => scenario.matches(args)
        ? scenario.result : run(executable, args, options);
      await assert.rejects(runPreflight({
        installed, target: manifest, updaterVersion: '1.0.0', config, dependencies: deps, diagnostics,
      }), /preflight/i);
      assert.equal(messages.length, 1);
      const entry = JSON.parse(messages[0]!);
      assert.equal(entry.stage, scenario.stage);
      assert.equal(entry.executable, 'docker');
      assert.equal('args' in entry, false);
      assert.equal(messages[0]!.includes(secret), false);
      assert.equal(entry.timedOut, scenario.result.code === 124);
    }
  } finally {
    console.error = originalError;
  }
});

test('preflight scopes Compose inspection to the configured project identity', async () => {
  const { root, config } = await hostFixture();
  try {
    const project = 'tomecms-test-abc123def456';
    Object.defineProperty(config, 'projectName', { value: project });
    const calls: string[][] = [];
    const deps = dependencies();
    deps.runCommand = async (executable, args) => {
      calls.push([executable, ...args]);
      return commandResult(0, args.includes('ps') ? composeHealth() : 'ok');
    };
    await runPreflight({ installed, target: manifest, updaterVersion: '1.0.0', config, dependencies: deps });
    assert.ok(calls.some((call) => call[0] === 'docker' && call[1] === 'compose' &&
      call[2] === '-p' && call[3] === project && call.includes('ps')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('preflight rejects malformed, missing and unhealthy Compose records', async () => {
  const { root, config } = await hostFixture();
  try {
    const invalid = [
      `${composeHealth()}\nnot-json`,
      `${composeHealth()}\n{}`,
      [
        { Service: 'app', State: 'running', Health: 'healthy' },
        { Service: 'postgres', State: 'running', Health: 'healthy' },
      ].map((record) => JSON.stringify(record)).join('\n'),
      [
        { Service: 'app', State: 'running', Health: 'healthy' },
        { Service: 'postgres', State: 'running', Health: 'unhealthy' },
        { Service: 'seaweedfs', State: 'running', Health: 'healthy' },
      ].map((record) => JSON.stringify(record)).join('\n'),
    ];
    for (const output of invalid) {
      const deps = dependencies();
      deps.runCommand = async (_executable, args) => commandResult(0, args.includes('ps') ? output : 'ok');
      await assert.rejects(runPreflight({
        installed, target: manifest, updaterVersion: '1.0.0', config, dependencies: deps,
      }), /compose|healthy/i);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('preflight rejects symlinked fixed files and installed image disagreement', async () => {
  const first = await hostFixture();
  try {
    await rm(first.config.environmentFile);
    await symlink(first.config.composeFile, first.config.environmentFile);
    await assert.rejects(runPreflight({
      installed, target: manifest, updaterVersion: '1.0.0', config: first.config,
      dependencies: dependencies(),
    }), /file|symlink|preflight/i);
  } finally {
    await rm(first.root, { recursive: true, force: true });
  }

  const second = await hostFixture();
  try {
    await writeFile(second.config.imageEnvironmentFile,
      `TOME_CMS_APP_IMAGE='${OFFICIAL_IMAGE_REPOSITORY}@sha256:${'c'.repeat(64)}'\n`);
    await assert.rejects(runPreflight({
      installed, target: manifest, updaterVersion: '1.0.0', config: second.config,
      dependencies: dependencies(),
    }), /image|state|preflight/i);
  } finally {
    await rm(second.root, { recursive: true, force: true });
  }
});
