import { lstatSync } from 'node:fs';
import { isAbsolute, join, normalize, parse, relative, sep } from 'node:path';

export interface UpdaterConfig {
  configVersion: 1;
  projectName: 'tomecms' | `tomecms-test-${string}`;
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
const pathRoots = {
  composeFile: '/opt/tome-cms',
  environmentFile: '/etc/tome-cms',
  imageEnvironmentFile: '/var/lib/tome-cms/updater',
  stateDirectory: '/var/lib/tome-cms/updater',
  backupDirectory: '/var/backups/tome-cms',
  socketPath: '/run/tome-cms',
  statusPath: '/run/tome-cms',
} as const;

type PathInspector = (path: string) => { isSymbolicLink(): boolean };

export function parseUpdaterConfig(value: unknown, inspectPath: PathInspector = lstatSync): UpdaterConfig {
  if (!isRecord(value) || !hasExactKeys(value, keys)) throw invalidConfig();
  for (const [key, expected] of Object.entries(fixed)) {
    if (value[key] !== expected) throw invalidConfig();
  }
  if (!Number.isSafeInteger(value.minimumFreeBytes) || (value.minimumFreeBytes as number) < minimumFreeBytes) {
    throw invalidConfig();
  }
  for (const [key, root] of Object.entries(pathRoots)) {
    assertSafePath(value[key], root, inspectPath);
  }
  return { ...value } as unknown as UpdaterConfig;
}

function assertSafePath(value: unknown, root: string, inspectPath: PathInspector): asserts value is string {
  if (typeof value !== 'string' || !isAbsolute(value) || normalize(value) !== value || parse(value).root === value) {
    throw invalidConfig();
  }
  const tail = relative(root, value);
  if (isAbsolute(tail) || tail === '..' || tail.startsWith(`..${sep}`)) throw invalidConfig();

  const filesystemRoot = parse(value).root;
  let candidate = filesystemRoot;
  for (const component of relative(filesystemRoot, value).split(sep).filter(Boolean)) {
    candidate = join(candidate, component);
    try {
      if (inspectPath(candidate).isSymbolicLink()) throw invalidConfig();
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return;
      throw invalidConfig();
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

function hasCode(value: unknown, code: string): boolean {
  return value instanceof Error && 'code' in value && value.code === code;
}

function invalidConfig(): Error {
  return new Error('Invalid updater configuration');
}
