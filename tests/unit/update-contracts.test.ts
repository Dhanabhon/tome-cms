import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareStableVersions,
  OFFICIAL_IMAGE_REPOSITORY,
  OFFICIAL_REPOSITORY,
  parseStableVersion,
  parseUpdateManifest,
} from '../../src/update/contracts.js';

const manifest = {
  format: 'tomecms-update', manifestVersion: 1, product: 'tomecms', channel: 'stable',
  version: '1.0.1', releasedAt: '2026-09-20T10:00:00.000Z',
  source: { repository: OFFICIAL_REPOSITORY, commit: '0'.repeat(40) },
  image: {
    repository: OFFICIAL_IMAGE_REPOSITORY,
    digest: `sha256:${'a'.repeat(64)}`,
    platforms: ['linux/amd64', 'linux/arm64'],
  },
  compatibility: {
    minimumDirectUpgradeFrom: '1.0.0', minimumUpdaterVersion: '1.0.0',
    targetMigration: '007_preview_tokens', rollbackSafeFrom: '1.0.0',
    composeContract: 1, environmentContract: 1, updaterProtocol: 1,
  },
  releaseNotesUrl: 'https://github.com/Dhanabhon/tome-cms/releases/tag/v1.0.1',
};

test('parses stable versions and compares numeric tuples', () => {
  assert.deepEqual(parseStableVersion('1.20.3'), { raw: '1.20.3', parts: [1, 20, 3] });
  assert.equal(compareStableVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareStableVersions('1.0.0', '1.0.0'), 0);
  for (const value of ['v1.0.0', '01.0.0', '1.0', '1.0.0-beta.1', '1.0.0+build']) {
    assert.throws(() => parseStableVersion(value), /stable version/i);
  }
});

test('accepts only the closed official manifest contract', () => {
  assert.equal(parseUpdateManifest(manifest).version, '1.0.1');
  for (const invalid of [
    { ...manifest, extra: true },
    { ...manifest, source: { ...manifest.source, repository: 'attacker/repo' } },
    { ...manifest, image: { ...manifest.image, repository: 'evil.example/app' } },
    { ...manifest, image: { ...manifest.image, platforms: ['linux/amd64', 'linux/amd64'] } },
    { ...manifest, releaseNotesUrl: 'https://evil.example/v1.0.1' },
  ]) assert.throws(() => parseUpdateManifest(invalid));
});
