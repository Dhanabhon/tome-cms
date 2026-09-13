import { request } from 'node:http';
import { isAbsolute } from 'node:path';
import { z } from 'zod';

import { compareStableVersions, parseStableVersion, type UpdateManifest } from '../../update/contracts.js';
import { HttpError } from '../http/errors.js';

export const UPDATER_RESPONSE_LIMIT = 4 * 1024;
const stableVersion = z.string().refine((value) => {
  try { parseStableVersion(value); return true; } catch { return false; }
});
const timestamp = z.string().refine((value) => {
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
});
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const phaseMessages = {
  preflight: 'Checking update prerequisites.',
  verifying: 'Verifying the official update.',
  downloading: 'Downloading the verified update.',
  quiescing: 'Preparing TomeCMS for maintenance.',
  backing_up: 'Creating a recovery backup.',
  migrating: 'Applying database migrations.',
  restarting: 'Starting the updated application.',
  health_check: 'Checking the updated application.',
  succeeded: 'Update installed successfully.',
  rolling_back: 'Restoring the previous application version.',
  rolled_back: 'The previous application version was restored.',
  failed_manual_recovery: 'Manual recovery is required.',
} as const;
const jobSchema = z.object({
  id: uuid, targetVersion: stableVersion,
  phase: z.enum(Object.keys(phaseMessages) as [keyof typeof phaseMessages, ...(keyof typeof phaseMessages)[]]),
  completedSteps: z.number().int().min(0).max(8), totalSteps: z.literal(8), message: z.string(),
  startedAt: timestamp, finishedAt: timestamp.nullable(), backupCreatedAt: timestamp.nullable(),
  errorCode: z.enum([
    'release_unavailable', 'incompatible_update', 'backup_failed', 'migration_failed',
    'health_failed', 'rolled_back', 'manual_recovery_required', 'preflight_failed',
    'verification_failed', 'download_failed', 'update_failed',
  ]).nullable(),
}).strict().refine((job) => {
  const step = Object.keys(phaseMessages).indexOf(job.phase);
  return job.message === phaseMessages[job.phase]
    && (step > 8 || job.completedSteps === step)
    && ['succeeded', 'rolled_back', 'failed_manual_recovery'].includes(job.phase) === (job.finishedAt !== null);
});
const statusSchema = z.object({
  protocolVersion: z.literal(1), updaterVersion: stableVersion, managed: z.literal(true),
  installed: z.object({ version: stableVersion, imageDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/) }).strict(),
  job: jobSchema.nullable(),
}).strict();

type ManagedUpdaterStatus = z.infer<typeof statusSchema>;
export type UpdaterStatus = ManagedUpdaterStatus | { managed: false };
export type UpdateRequestResult =
  | { outcome: 'accepted'; job: NonNullable<ManagedUpdaterStatus['job']> }
  | { outcome: 'already_installed'; installed: ManagedUpdaterStatus['installed'] };
export function parseUpdaterStatus(value: unknown): ManagedUpdaterStatus {
  return statusSchema.parse(value);
}

export function getManagedInstallability(check: {
  currentVersion: string;
  availability: string;
  latest: { manifest: Pick<UpdateManifest, 'version' | 'compatibility'> } | null;
}, updater: UpdaterStatus): { mode: 'check-only' | 'managed'; installable: boolean; reason: string } {
  if (!updater.managed) return { mode: 'check-only', installable: false, reason: 'Managed updater unavailable.' };
  const unavailable = (reason: string) => ({ mode: 'managed' as const, installable: false, reason });
  if (updater.job?.phase === 'failed_manual_recovery') return unavailable('Manual recovery is required. Contact your server operator.');
  if (updater.job && !['succeeded', 'rolled_back'].includes(updater.job.phase)) return unavailable('An update is in progress.');
  if (!check.latest || check.availability !== 'available') return unavailable('No compatible update is available.');
  const { version, compatibility } = check.latest.manifest;
  if (updater.installed.version !== check.currentVersion
    || compareStableVersions(check.currentVersion, '1.0.0') < 0
    || compareStableVersions(version, check.currentVersion) <= 0
    || compareStableVersions(check.currentVersion, compatibility.minimumDirectUpgradeFrom) < 0
    || compareStableVersions(check.currentVersion, compatibility.rollbackSafeFrom) < 0
    || compareStableVersions(updater.updaterVersion, compatibility.minimumUpdaterVersion) < 0
    || compatibility.updaterProtocol !== 1 || compatibility.composeContract !== 1 || compatibility.environmentContract !== 1) {
    return unavailable('Manual updater upgrade required. See the official release notes.');
  }
  return { mode: 'managed', installable: true, reason: 'This managed installation can install the verified update.' };
}

interface SocketOptions { socketPath?: string; timeoutMs?: number }

export async function getUpdaterStatus(options: SocketOptions = {}): Promise<UpdaterStatus> {
  try {
    const response = await socketRequest('GET', '/v1/status', options);
    if (response.status !== 200) return { managed: false };
    return parseUpdaterStatus(response.body);
  } catch {
    return { managed: false };
  }
}

export async function requestUpdate(options: SocketOptions & { version: string; requestId: string }): Promise<UpdateRequestResult> {
  const body = { version: stableVersion.parse(options.version), requestId: uuid.parse(options.requestId) };
  try {
    const response = await socketRequest('POST', '/v1/apply', options, body);
    if (response.status === 409) {
      const refusal = z.object({ error: z.enum(['update_in_progress', 'manual_recovery_required']) }).strict().parse(response.body);
      throw new HttpError(409, refusal.error === 'update_in_progress'
        ? 'An update is already in progress.' : 'Manual recovery is required.');
    }
    if (response.status === 200) {
      const status = parseUpdaterStatus(response.body);
      if (status.installed.version !== body.version) throw new Error('Unexpected installed version');
      return { outcome: 'already_installed', installed: status.installed };
    }
    if (response.status !== 202) throw new Error('Unexpected updater response');
    const job = jobSchema.parse(response.body);
    if (job.targetVersion !== body.version) throw new Error('Unexpected update target');
    return { outcome: 'accepted', job };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, 'Managed updater unavailable. Try again shortly.');
  }
}

async function socketRequest(method: 'GET' | 'POST', path: string, options: SocketOptions, body?: unknown): Promise<{ status: number; body: unknown }> {
  const socketPath = options.socketPath ?? '/run/tome-cms/updater.sock';
  if (!isAbsolute(socketPath) || !socketPath.endsWith('.sock') || socketPath.includes('\0')) throw new Error('Invalid updater socket');
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, path, method, agent: false, headers: {
      Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
    } });
    const deadline = setTimeout(() => req.destroy(new Error('Updater request timed out')), Math.min(options.timeoutMs ?? 2000, 2000));
    const fail = (error: Error) => { clearTimeout(deadline); reject(error); };
    req.on('error', fail);
    req.on('response', (res) => {
      const chunks: Buffer[] = [];
      let length = 0;
      if (!/^application\/json(?:;|$)/i.test(res.headers['content-type'] ?? '') || Number(res.headers['content-length']) > UPDATER_RESPONSE_LIMIT) {
        req.destroy(new Error('Invalid updater response')); return;
      }
      res.on('error', fail);
      res.on('data', (chunk: Buffer) => {
        length += chunk.length;
        if (length > UPDATER_RESPONSE_LIMIT) req.destroy(new Error('Updater response too large'));
        else chunks.push(chunk);
      });
      res.on('end', () => {
        clearTimeout(deadline);
        try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch { reject(new Error('Invalid updater response')); }
      });
    });
    req.end(payload);
  });
}
