import assert from 'node:assert/strict';
import { mkdtemp, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { parseUpdaterConfig } from '../../src/updater/config.js';

const validConfig = {
  configVersion: 1,
  projectName: 'tomecms',
  composeFile: '/opt/tome-cms/compose.managed.yaml',
  environmentFile: '/etc/tome-cms/tome-cms.env',
  imageEnvironmentFile: '/var/lib/tome-cms/updater/image.env',
  stateDirectory: '/var/lib/tome-cms/updater',
  backupDirectory: '/var/backups/tome-cms',
  socketPath: '/run/tome-cms/updater.sock',
  statusPath: '/run/tome-cms/status.json',
  appHealthUrl: 'http://127.0.0.1:4321/health/ready',
  minimumFreeBytes: 5 * 1024 ** 3,
};

test('accepts only the fixed managed updater configuration', () => {
  assert.deepEqual(parseUpdaterConfig(validConfig), validConfig);

  for (const invalid of [
    { ...validConfig, projectName: 'customer-input' },
    { ...validConfig, composeFile: '/tmp/compose.yaml' },
    { ...validConfig, composeFile: '/opt/tome-cms/../compose.yaml' },
    { ...validConfig, stateDirectory: '/' },
    { ...validConfig, socketPath: '/var/run/docker.sock' },
    { ...validConfig, appHealthUrl: 'https://evil.example/ready' },
    { ...validConfig, minimumFreeBytes: 5 * 1024 ** 3 - 1 },
    { ...validConfig, repository: 'attacker/tome-cms' },
    { ...validConfig, image: 'evil.example/tome-cms' },
  ]) assert.throws(() => parseUpdaterConfig(invalid), /updater configuration/i);
});

test('rejects non-record input and symbolic-link paths', async () => {
  for (const invalid of [null, [], 'config']) {
    assert.throws(() => parseUpdaterConfig(invalid), /updater configuration/i);
  }

  const directory = await mkdtemp(join(tmpdir(), 'tomecms-updater-config-'));
  const link = join(directory, 'compose.managed.yaml');
  await symlink('/opt/tome-cms/compose.managed.yaml', link);
  assert.throws(() => parseUpdaterConfig({ ...validConfig, composeFile: link }), /updater configuration/i);
});
