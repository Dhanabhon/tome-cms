import type { CliContext } from '../../src/cli/main.js';
import type { SocketAnswer } from '../../src/cli/socket.js';
import type { UpdaterConfig } from '../../src/updater/config.js';

type Route = SocketAnswer | Error | ((body: unknown) => SocketAnswer | Error);

/**
 * A `tome` context with nothing real behind it. Each socket route answers from its list in turn and
 * repeats the last answer; a route that is not listed is a test failure.
 */
export function fakeContext(input: {
  routes?: Record<string, Route[]>;
  config?: Partial<UpdaterConfig>;
  overrides?: Partial<CliContext>;
} = {}) {
  const printed: string[] = [];
  const warned: string[] = [];
  const prompts: string[] = [];
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const routes = input.routes ?? {};
  const context: CliContext = {
    config: {
      configVersion: 1, projectName: 'tomecms', composeFile: '/opt/tome-cms/compose.managed.yaml',
      environmentFile: '/etc/tome-cms/tome-cms.env', imageEnvironmentFile: '/var/lib/tome-cms/updater/image.env',
      stateDirectory: '/var/lib/tome-cms/updater', backupDirectory: '/var/backups/tome-cms',
      socketPath: '/run/tome-cms/updater.sock', statusPath: '/run/tome-cms/status.json',
      appHealthUrl: 'http://127.0.0.1:4321/health/ready', minimumFreeBytes: 5 * 1024 ** 3,
      ...input.config,
    },
    socket: async (method, path, body) => {
      calls.push({ method, path, body });
      const list = routes[`${method} ${path}`];
      if (!list?.length) throw new Error(`Unexpected ${method} ${path}`);
      const route = list.length > 1 ? list.shift()! : list[0]!;
      const answer = typeof route === 'function' ? route(body) : route;
      if (answer instanceof Error) throw answer;
      return answer;
    },
    runCommand: async () => { throw new Error('Unexpected command'); },
    streamCommand: async () => { throw new Error('Unexpected command'); },
    fetch: async () => { throw new Error('Unexpected fetch'); },
    release: async () => { throw new Error('Unexpected release check'); },
    statfs: async () => ({ bsize: 4096, bavail: 10 * 1024 ** 3 / 4096 }),
    confirm: async (question) => { prompts.push(question); return true; },
    print: (line) => { printed.push(line); },
    warn: (line) => { warned.push(line); },
    now: () => new Date('2026-10-02T12:00:00.000Z'),
    sleep: async () => undefined,
    requestId: () => '11111111-1111-4111-8111-111111111111',
    ...input.overrides,
  };
  return {
    context, printed, warned, prompts, calls,
    out: () => printed.join('\n'),
    err: () => warned.join('\n'),
  };
}

export const requestId = '11111111-1111-4111-8111-111111111111';
export const jobId = '22222222-2222-4222-8222-222222222222';
export const digest = `sha256:${'a'.repeat(64)}`;

const updateSteps = ['preflight', 'verifying', 'downloading', 'quiescing', 'backing_up', 'migrating', 'restarting', 'health_check', 'succeeded'];

/** An update job as `/v1/status` shows it. */
export function updateJob(phase: string, patch: Record<string, unknown> = {}) {
  const step = updateSteps.indexOf(phase);
  const terminal = ['succeeded', 'rolled_back', 'failed_manual_recovery'].includes(phase);
  return {
    id: jobId, targetVersion: '1.11.0', phase, completedSteps: step >= 0 ? step : 4, totalSteps: 8,
    message: 'fixture', startedAt: '2026-10-02T11:00:00.000Z',
    finishedAt: terminal ? '2026-10-02T11:05:00.000Z' : null, errorCode: null, backupCreatedAt: null, ...patch,
  };
}

export function statusAnswer(job: unknown = null, version = '1.10.1'): SocketAnswer {
  return { status: 200, body: { protocolVersion: 1, updaterVersion: '1.5.0', managed: true, installed: { version, imageDigest: digest }, job } };
}

/** A backup record as `GET /v1/backup` shows it. */
export function backupRecord(phase: string, patch: Record<string, unknown> = {}) {
  const ended = phase === 'succeeded' || phase === 'failed';
  return {
    id: requestId, kind: 'database', phase, startedAt: '2026-10-02T11:00:00.000Z',
    finishedAt: ended ? '2026-10-02T11:03:00.000Z' : null,
    backupDirectory: phase === 'succeeded' ? '/var/backups/tome-cms/tomecms-20261002T110000000Z' : null,
    sizeBytes: phase === 'succeeded' ? 12 * 1024 ** 2 : null, errorCode: null, ...patch,
  };
}
