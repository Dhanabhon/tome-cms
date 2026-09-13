import { lstatSync } from 'node:fs';
import { isAbsolute, normalize, parse } from 'node:path';

export interface UpdaterConfig {
  configVersion: 1;
  projectName: 'tomecms';
  composeFile: string;
  environmentFile: string;
  imageEnvironmentFile: string;
  stateDirectory: string;
  backupDirectory: string;
  socketPath: string;
  statusPath: string;
  appHealthUrl: string;
  minimumFreeBytes: number;
}

const fixed = {
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
} as const;

const keys = [...Object.keys(fixed), 'minimumFreeBytes'];
const minimumFreeBytes = 5 * 1024 ** 3;

export function parseUpdaterConfig(value: unknown): UpdaterConfig {
  if (!isRecord(value) || !hasExactKeys(value, keys)) throw invalidConfig();
  for (const [key, expected] of Object.entries(fixed)) {
    if (value[key] !== expected) throw invalidConfig();
  }
  if (!Number.isSafeInteger(value.minimumFreeBytes) || (value.minimumFreeBytes as number) < minimumFreeBytes) {
    throw invalidConfig();
  }
  for (const key of ['composeFile', 'environmentFile', 'imageEnvironmentFile', 'stateDirectory', 'backupDirectory', 'socketPath', 'statusPath']) {
    assertSafePath(value[key]);
  }
  return { ...value } as unknown as UpdaterConfig;
}

function assertSafePath(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !isAbsolute(value) || normalize(value) !== value || parse(value).root === value) {
    throw invalidConfig();
  }
  try {
    if (lstatSync(value).isSymbolicLink()) throw invalidConfig();
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'EACCES'))) {
      throw error;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && actual.every((key) => expected.includes(key));
}

function invalidConfig(): Error {
  return new Error('Invalid updater configuration');
}
