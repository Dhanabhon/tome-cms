import assert from 'node:assert/strict';
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
const regularPath = () => ({ isSymbolicLink: () => false });

test('accepts only the fixed managed updater configuration', () => {
  assert.deepEqual(parseUpdaterConfig(validConfig, regularPath), validConfig);

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
  ]) assert.throws(() => parseUpdaterConfig(invalid, regularPath), /updater configuration/i);
});

test('rejects non-record input and symlinks at any existing path component', () => {
  for (const invalid of [null, [], 'config']) {
    assert.throws(() => parseUpdaterConfig(invalid, regularPath), /updater configuration/i);
  }

  for (const symlinkPath of [
    '/opt',
    '/var/lib/tome-cms',
    '/opt/tome-cms',
    '/opt/tome-cms/compose.managed.yaml',
  ]) {
    assert.throws(() => parseUpdaterConfig(validConfig, (path) => ({
      isSymbolicLink: () => path === symlinkPath,
    })), /updater configuration/i);
  }
});

test('fails closed on inspection errors but permits a legitimately absent tail', () => {
  const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' });
  assert.throws(() => parseUpdaterConfig(validConfig, (path) => {
    if (path === '/etc/tome-cms') throw denied;
    return regularPath();
  }), /updater configuration/i);

  const inspected: string[] = [];
  const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
  assert.deepEqual(parseUpdaterConfig(validConfig, (path) => {
    inspected.push(path);
    if (path === '/run/tome-cms') throw missing;
    return regularPath();
  }), validConfig);
  assert.equal(inspected.includes('/'), false);
  assert.equal(inspected.includes('/run'), true);
  assert.equal(inspected.includes('/run/tome-cms/updater.sock'), false);
  assert.equal(inspected.includes('/run/tome-cms/status.json'), false);
});
