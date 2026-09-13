import { randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';

import { parseStableVersion } from '../update/contracts.js';
import type { UpdaterConfig } from './config.js';

export type UpdatePhase =
  | 'preflight' | 'verifying' | 'downloading' | 'quiescing'
  | 'backing_up' | 'migrating' | 'restarting' | 'health_check'
  | 'rolling_back' | 'succeeded' | 'rolled_back' | 'failed_manual_recovery';

export interface InstalledState {
  version: string;
  imageDigest: string;
  composeContract: 1;
  environmentContract: 1;
  updaterProtocol: 1;
  installedAt: string;
}

export interface UpdateJob {
  id: string;
  requestId: string;
  targetVersion: string;
  previousVersion: string;
  previousImageDigest: string;
  targetImageDigest: string | null;
  phase: UpdatePhase;
  completedSteps: number;
  totalSteps: 8;
  message: string;
  startedAt: string;
  finishedAt: string | null;
  errorCode: string | null;
  backupDirectory: string | null;
  backupCreatedAt: string | null;
}

export type PublicUpdateJob = Pick<UpdateJob,
  | 'id' | 'targetVersion' | 'phase' | 'completedSteps' | 'totalSteps'
  | 'message' | 'startedAt' | 'finishedAt' | 'errorCode' | 'backupCreatedAt'
>;

export interface UpdaterStateStore {
  readInstalled(): Promise<InstalledState>;
  writeInstalled(value: InstalledState): Promise<void>;
  readJob(): Promise<UpdateJob | null>;
  createJob(input: Pick<UpdateJob, 'requestId' | 'targetVersion'>): Promise<UpdateJob>;
  transitionJob(id: string, phase: UpdatePhase, patch?: Partial<Pick<UpdateJob,
    'targetImageDigest' | 'finishedAt' | 'errorCode' | 'backupDirectory' | 'backupCreatedAt'
  >>): Promise<UpdateJob>;
}

const phases: readonly UpdatePhase[] = [
  'preflight', 'verifying', 'downloading', 'quiescing', 'backing_up', 'migrating',
  'restarting', 'health_check', 'rolling_back', 'succeeded', 'rolled_back',
  'failed_manual_recovery',
];
const terminalPhases = new Set<UpdatePhase>(['succeeded', 'rolled_back', 'failed_manual_recovery']);
const forwardPhases: Partial<Record<UpdatePhase, UpdatePhase>> = {
  preflight: 'verifying',
  verifying: 'downloading',
  downloading: 'quiescing',
  quiescing: 'backing_up',
  backing_up: 'migrating',
  migrating: 'restarting',
  restarting: 'health_check',
  health_check: 'succeeded',
};
const completedSteps: Record<UpdatePhase, number | null> = {
  preflight: 0,
  verifying: 1,
  downloading: 2,
  quiescing: 3,
  backing_up: 4,
  migrating: 5,
  restarting: 6,
  health_check: 7,
  succeeded: 8,
  rolling_back: null,
  rolled_back: null,
  failed_manual_recovery: null,
};
const messages: Record<UpdatePhase, string> = {
  preflight: 'Checking update prerequisites.',
  verifying: 'Verifying the official update.',
  downloading: 'Downloading the verified update.',
  quiescing: 'Preparing TomeCMS for maintenance.',
  backing_up: 'Creating a recovery backup.',
  migrating: 'Applying database migrations.',
  restarting: 'Starting the updated application.',
  health_check: 'Checking the updated application.',
  rolling_back: 'Restoring the previous application version.',
  succeeded: 'Update installed successfully.',
  rolled_back: 'The previous application version was restored.',
  failed_manual_recovery: 'Manual recovery is required.',
};
const installedKeys = [
  'version', 'imageDigest', 'composeContract', 'environmentContract', 'updaterProtocol', 'installedAt',
] as const;
const jobKeys = [
  'id', 'requestId', 'targetVersion', 'previousVersion', 'previousImageDigest',
  'targetImageDigest', 'phase', 'completedSteps', 'totalSteps', 'message', 'startedAt',
  'finishedAt', 'errorCode', 'backupDirectory', 'backupCreatedAt',
] as const;
const patchKeys = ['targetImageDigest', 'finishedAt', 'errorCode', 'backupDirectory', 'backupCreatedAt'];

export function createUpdaterStateStore(config: UpdaterConfig): UpdaterStateStore {
  const installedPath = join(config.stateDirectory, 'installed.json');
  const jobPath = join(config.stateDirectory, 'job.json');
  let pending: Promise<void> = Promise.resolve();

  const exclusive = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = pending.then(operation, operation);
    pending = result.then(() => undefined, () => undefined);
    return result;
  };

  const readInstalled = async (): Promise<InstalledState> => parseInstalled(await readJson(installedPath));
  const readJob = async (): Promise<UpdateJob | null> => {
    try {
      return parseJob(await readJson(jobPath));
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return null;
      throw error;
    }
  };
  const writeStatus = async (installed: InstalledState, job: UpdateJob | null): Promise<void> => {
    await atomicJson(config.statusPath, {
      protocolVersion: 1,
      updaterVersion: '1.0.0',
      managed: true,
      installed: { version: installed.version, imageDigest: installed.imageDigest },
      job: job ? toPublicUpdateJob(job) : null,
    }, 0o640);
  };

  return {
    readInstalled,
    readJob,
    writeInstalled(value) {
      return exclusive(async () => {
        const installed = parseInstalled(value);
        await atomicJson(installedPath, installed, 0o600);
        await writeStatus(installed, await readJob());
      });
    },
    createJob(input) {
      return exclusive(async () => {
        const existing = await readJob();
        if (existing && !terminalPhases.has(existing.phase)) throw new Error('An update job is already active');
        parseStableVersion(input.targetVersion);
        if (!uuid(input.requestId)) throw new Error('Invalid update request ID');
        const installed = await readInstalled();
        const startedAt = new Date().toISOString();
        const job: UpdateJob = {
          id: randomUUID(), requestId: input.requestId, targetVersion: input.targetVersion,
          previousVersion: installed.version, previousImageDigest: installed.imageDigest,
          targetImageDigest: null, phase: 'preflight', completedSteps: 0, totalSteps: 8,
          message: messages.preflight, startedAt, finishedAt: null, errorCode: null,
          backupDirectory: null, backupCreatedAt: null,
        };
        await atomicJson(jobPath, job, 0o600);
        await writeStatus(installed, job);
        return job;
      });
    },
    transitionJob(id, phase, patch = {}) {
      return exclusive(async () => {
        if (!isRecord(patch) || !hasExactSubset(patch, patchKeys)) throw new Error('Invalid update job patch');
        const current = await readJob();
        if (!current || current.id !== id) throw new Error('Update job not found');
        if (terminalPhases.has(current.phase)) throw new Error('Update job is terminal');
        if (!validTransition(current.phase, phase)) throw new Error('Invalid update job transition');
        const terminal = terminalPhases.has(phase);
        const job = parseJob({
          ...current,
          ...patch,
          phase,
          completedSteps: completedSteps[phase] ?? current.completedSteps,
          message: messages[phase],
          finishedAt: terminal ? patch.finishedAt ?? new Date().toISOString() : null,
        });
        const installed = await readInstalled();
        await atomicJson(jobPath, job, 0o600);
        await writeStatus(installed, job);
        return job;
      });
    },
  };
}

export function toPublicUpdateJob(job: UpdateJob): PublicUpdateJob {
  const {
    id, targetVersion, phase, completedSteps: completed, totalSteps, message,
    startedAt, finishedAt, errorCode, backupCreatedAt,
  } = job;
  return {
    id, targetVersion, phase, completedSteps: completed, totalSteps, message,
    startedAt, finishedAt, errorCode, backupCreatedAt,
  };
}

function validTransition(from: UpdatePhase, to: UpdatePhase): boolean {
  if (from === 'rolling_back') return to === 'rolled_back' || to === 'failed_manual_recovery';
  return forwardPhases[from] === to || to === 'rolling_back' || to === 'failed_manual_recovery';
}

function parseInstalled(value: unknown): InstalledState {
  if (!isRecord(value) || !hasExactKeys(value, installedKeys)) throw invalidInstalled();
  try {
    parseStableVersion(value.version);
  } catch {
    throw invalidInstalled();
  }
  if (!digest(value.imageDigest) || value.composeContract !== 1 || value.environmentContract !== 1 ||
    value.updaterProtocol !== 1 || !isoDate(value.installedAt)) throw invalidInstalled();
  return { ...value } as unknown as InstalledState;
}

function parseJob(value: unknown): UpdateJob {
  if (!isRecord(value) || !hasExactKeys(value, jobKeys)) throw invalidJob();
  try {
    parseStableVersion(value.targetVersion);
    parseStableVersion(value.previousVersion);
  } catch {
    throw invalidJob();
  }
  const phase = value.phase as UpdatePhase;
  if (!uuid(value.id) || !uuid(value.requestId) || !digest(value.previousImageDigest) ||
    !(value.targetImageDigest === null || digest(value.targetImageDigest)) ||
    !phases.includes(phase) ||
    !Number.isSafeInteger(value.completedSteps) || (value.completedSteps as number) < 0 ||
    (value.completedSteps as number) > 8 || value.totalSteps !== 8 ||
    value.message !== messages[phase] || !isoDate(value.startedAt) ||
    !(value.finishedAt === null || isoDate(value.finishedAt)) ||
    !(value.errorCode === null || (typeof value.errorCode === 'string' && /^[a-z][a-z0-9_]*$/.test(value.errorCode))) ||
    !(value.backupDirectory === null || (typeof value.backupDirectory === 'string' && isAbsolute(value.backupDirectory))) ||
    !(value.backupCreatedAt === null || isoDate(value.backupCreatedAt))) throw invalidJob();
  const expectedCompleted = completedSteps[phase];
  if ((expectedCompleted !== null && value.completedSteps !== expectedCompleted) ||
    terminalPhases.has(phase) !== (value.finishedAt !== null)) throw invalidJob();
  return { ...value } as unknown as UpdateJob;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function atomicJson(path: string, value: unknown, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = join(dirname(path), `.${path.split('/').at(-1)}.${randomUUID()}`);
  const handle = await open(temporaryPath, 'wx', mode);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
    await handle.sync();
  } catch (error) {
    await handle.close();
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  await handle.close();
  await rename(temporaryPath, path);
  await chmod(path, mode);
  const directory = await open(dirname(path), 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
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

function hasExactSubset(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function uuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function digest(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
}

function isoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function hasCode(value: unknown, code: string): boolean {
  return value instanceof Error && 'code' in value && value.code === code;
}

function invalidInstalled(): Error {
  return new Error('Invalid installed state');
}

function invalidJob(): Error {
  return new Error('Invalid update job state');
}
