import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { buildReleaseManifest } from '../../scripts/release-manifest.js';

const validInput = {
  packageVersion: '1.0.1', tag: 'v1.0.1', commit: 'a'.repeat(40),
  digest: `sha256:${'b'.repeat(64)}`,
  releasedAt: '2026-09-20T10:00:00.000Z',
  minimumDirectUpgradeFrom: '1.0.0', minimumUpdaterVersion: '1.0.0',
  targetMigration: '007_preview_tokens', rollbackSafeFrom: '1.0.0',
};

test('builds the official manifest only when package, tag and digest agree', () => {
  const result = buildReleaseManifest(validInput);
  assert.equal(result.version, '1.0.1');
  assert.equal(result.image.repository, 'ghcr.io/dhanabhon/tome-cms');
  assert.throws(() => buildReleaseManifest({ ...validInput, tag: 'v1.0.2' }), /tag/i);
  assert.throws(() => buildReleaseManifest({ ...validInput, commit: 'main' }), /commit/i);
  assert.throws(() => buildReleaseManifest({ ...validInput, digest: 'sha256:bad' }), /digest/i);
  assert.throws(() => buildReleaseManifest({ ...validInput, rollbackSafeFrom: '1.0.2' }), /rollback/i);
});

test('writes one manifest and refuses to overwrite it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tomecms-release-manifest-'));
  const output = join(directory, 'update-manifest.json');
  const args = [
    '--package-version', validInput.packageVersion,
    '--tag', validInput.tag,
    '--commit', validInput.commit,
    '--digest', validInput.digest,
    '--released-at', validInput.releasedAt,
    '--minimum-direct-upgrade-from', validInput.minimumDirectUpgradeFrom,
    '--minimum-updater-version', validInput.minimumUpdaterVersion,
    '--target-migration', validInput.targetMigration,
    '--rollback-safe-from', validInput.rollbackSafeFrom,
    '--output', output,
  ];

  try {
    const first = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/release-manifest.ts', ...args], {
      cwd: process.cwd(), encoding: 'utf8',
    });
    assert.equal(first.status, 0, first.stderr);
    const bytes = await readFile(output, 'utf8');
    assert.equal(bytes, `${JSON.stringify(buildReleaseManifest(validInput), null, 2)}\n`);

    const second = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/release-manifest.ts', ...args], {
      cwd: process.cwd(), encoding: 'utf8',
    });
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /exist|overwrite/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects unknown manifest CLI arguments', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tomecms-release-manifest-'));
  const output = join(directory, 'update-manifest.json');
  try {
    const result = spawnSync(process.execPath, [
      '--import', 'tsx', 'scripts/release-manifest.ts',
      '--package-version', validInput.packageVersion,
      '--tag', validInput.tag,
      '--commit', validInput.commit,
      '--digest', validInput.digest,
      '--released-at', validInput.releasedAt,
      '--minimum-direct-upgrade-from', validInput.minimumDirectUpgradeFrom,
      '--minimum-updater-version', validInput.minimumUpdaterVersion,
      '--target-migration', validInput.targetMigration,
      '--rollback-safe-from', validInput.rollbackSafeFrom,
      '--output', output,
      '--ignored', 'value',
    ], { cwd: process.cwd(), encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unknown/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
