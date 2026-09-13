import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  OFFICIAL_IMAGE_REPOSITORY,
  OFFICIAL_REPOSITORY,
  type UpdateManifest,
} from '../../src/update/contracts.js';
import type { UpdaterConfig } from '../../src/updater/config.js';
import type { CommandResult } from '../../src/updater/process.js';
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
  return JSON.stringify([
    { Service: 'app', State: 'running', Health: 'healthy' },
    { Service: 'postgres', State: 'running', Health: 'healthy' },
    { Service: 'seaweedfs', State: 'running', Health: 'healthy' },
  ]);
}

function releaseFor(value: unknown, override: Record<string, unknown> = {}) {
  const bytes = Buffer.from(JSON.stringify(value));
  const digest = createHash('sha256').update(bytes).digest('hex');
  const version = typeof value === 'object' && value !== null && 'version' in value &&
    typeof value.version === 'string' ? value.version : '1.0.1';
  return {
    bytes,
    release: {
      tag_name: `v${version}`, draft: false, prerelease: false, immutable: true,
      published_at: '2026-09-20T10:01:00.000Z',
      html_url: `https://github.com/Dhanabhon/tome-cms/releases/tag/v${version}`,
      assets: [{
        name: 'update-manifest.json',
        browser_download_url: `https://github.com/Dhanabhon/tome-cms/releases/download/v${version}/update-manifest.json`,
        digest: `sha256:${digest}`,
      }],
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
} = {}): VerifyDependencies {
  const events = input.events ?? [];
  const fixture = releaseFor(input.value ?? manifest);
  const release = input.release ?? fixture.release;
  const manifestBytes = input.manifestBytes ?? fixture.bytes;
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
        events.push('github:manifest');
        return new Response(Buffer.from(manifestBytes));
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
  let manifestPath = '';
  const deps = dependencies({ events });
  const originalRun = deps.runCommand;
  deps.runCommand = async (executable, args, options) => {
    if (executable === 'gh' && args[0] === 'attestation' && !args[2]?.startsWith('oci://')) {
      manifestPath = args[2];
      assert.deepEqual(args.slice(0, 2), ['attestation', 'verify']);
      assert.deepEqual(args.slice(3), ['-R', OFFICIAL_REPOSITORY]);
      assert.deepEqual(await readFile(manifestPath), releaseFor(manifest).bytes);
    }
    if (executable === 'gh' && args[2]?.startsWith('oci://')) {
      assert.deepEqual(args, [
        'attestation', 'verify', `oci://${OFFICIAL_IMAGE_REPOSITORY}@${manifest.image.digest}`,
        '-R', OFFICIAL_REPOSITORY,
      ]);
    }
    return originalRun(executable, args, options);
  };

  try {
    const verified = await verifyTargetRelease({
      version: '1.0.1', installed, updaterVersion: '1.0.0', config, dependencies: deps,
    });
    assert.equal(verified.manifest.version, '1.0.1');
    assert.equal(verified.imageReference, `${OFFICIAL_IMAGE_REPOSITORY}@${manifest.image.digest}`);
    assert.equal(verified.manifestPath, manifestPath);
    assert.deepEqual(events, [
      'github:release:v1.0.1', 'github:manifest', 'gh:manifest-attestation',
      'gh:image-attestation', 'health', 'disk', 'platform',
    ]);
    await assert.rejects(readFile(manifestPath), { code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects mutable metadata, duplicate official assets and asset digest mismatch before attestation', async () => {
  const { root, config } = await hostFixture();
  try {
    const fixture = releaseFor(manifest);
    const duplicate = [...fixture.release.assets, { ...fixture.release.assets[0] }];
    for (const release of [
      { ...fixture.release, immutable: false },
      { ...fixture.release, assets: duplicate },
    ]) {
      const events: string[] = [];
      await assert.rejects(verifyTargetRelease({
        version: '1.0.1', installed, updaterVersion: '1.0.0', config,
        dependencies: dependencies({ release, events }),
      }), /release/i);
      assert.equal(events.some((event) => event.startsWith('gh:')), false);
    }

    const events: string[] = [];
    await assert.rejects(verifyTargetRelease({
      version: '1.0.1', installed, updaterVersion: '1.0.0', config,
      dependencies: dependencies({
        release: {
          ...fixture.release,
          assets: [{ ...fixture.release.assets[0], digest: `sha256:${'f'.repeat(64)}` }],
        },
        events,
      }),
    }), /digest/i);
    assert.equal(events.some((event) => event.startsWith('gh:')), false);
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
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('fails closed when either attestation fails and always removes its private manifest', async () => {
  const { root, config } = await hostFixture();
  try {
    for (const commandFailure of ['manifest', 'image'] as const) {
      let privatePath = '';
      const deps = dependencies({ commandFailure });
      const run = deps.runCommand;
      deps.runCommand = async (executable, args, options) => {
        if (executable === 'gh' && args[0] === 'attestation' && !args[2]?.startsWith('oci://')) privatePath = args[2];
        return run(executable, args, options);
      };
      await assert.rejects(verifyTargetRelease({
        version: '1.0.1', installed, updaterVersion: '1.0.0', config, dependencies: deps,
      }), /attestation/i);
      assert.ok(privatePath);
      await assert.rejects(readFile(privatePath), { code: 'ENOENT' });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects every incompatible direct upgrade before image attestation', async () => {
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
      assert.equal(events.includes('gh:image-attestation'), false);
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

test('preflight uses fixed read-only command arguments and rejects unhealthy services', async () => {
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

    deps.runCommand = async (_executable, args) => commandResult(0, args.includes('ps')
      ? JSON.stringify([{ Service: 'app', State: 'running', Health: 'unhealthy' }])
      : 'ok');
    await assert.rejects(runPreflight({
      installed, target: manifest, updaterVersion: '1.0.0', config, dependencies: deps,
    }), /healthy|preflight/i);
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
