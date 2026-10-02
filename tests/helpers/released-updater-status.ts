import { z } from 'zod';

import { parseStableVersion } from '../../src/update/contracts.js';

// The status schemas of apps already installed on servers, copied word for word from
// src/server/update/updater-client.ts at v1.9.1 and at 1.10.1 (c99fa3ce). They parse the
// updater's /v1/status and status.json strictly, so a new field there, or a phase or code they do
// not know, makes the app take its server for one it cannot update. Never edit them to make a
// test pass: an updater must keep answering these.
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
const phase = z.enum(Object.keys(phaseMessages) as [keyof typeof phaseMessages, ...(keyof typeof phaseMessages)[]]);
const jobRefinement = (job: { phase: keyof typeof phaseMessages; message: string; completedSteps: number; finishedAt: string | null }) => {
  const step = Object.keys(phaseMessages).indexOf(job.phase);
  return job.message === phaseMessages[job.phase]
    && (step > 8 || job.completedSteps === step)
    && ['succeeded', 'rolled_back', 'failed_manual_recovery'].includes(job.phase) === (job.finishedAt !== null);
};
const installed = z.object({ version: stableVersion, imageDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/) }).strict();

const jobSchema191 = z.object({
  id: uuid, targetVersion: stableVersion,
  phase,
  completedSteps: z.number().int().min(0).max(8), totalSteps: z.literal(8), message: z.string(),
  startedAt: timestamp, finishedAt: timestamp.nullable(), backupCreatedAt: timestamp.nullable(),
  errorCode: z.enum([
    'release_unavailable', 'incompatible_update', 'backup_failed', 'migration_failed',
    'health_failed', 'rolled_back', 'manual_recovery_required', 'preflight_failed',
    'verification_failed', 'download_failed', 'update_failed',
  ]).nullable(),
}).strict().refine(jobRefinement);

const updaterErrorCodes = [
  'release_unavailable', 'incompatible_update', 'backup_failed', 'migration_failed',
  'health_failed', 'rolled_back', 'manual_recovery_required', 'preflight_failed',
  'verification_failed', 'download_failed', 'update_failed', 'insufficient_disk_space',
] as const;
const jobSchema1101 = z.object({
  id: uuid, targetVersion: stableVersion,
  phase,
  completedSteps: z.number().int().min(0).max(8), totalSteps: z.literal(8), message: z.string(),
  startedAt: timestamp, finishedAt: timestamp.nullable(), backupCreatedAt: timestamp.nullable(),
  errorCode: z.string().regex(/^[a-z][a-z0-9_]*$/)
    .transform((code) => (updaterErrorCodes as readonly string[]).includes(code) ? code : 'update_failed')
    .nullable(),
}).strict().refine(jobRefinement);

export const releasedStatusSchemas = {
  '1.9.1': z.object({
    protocolVersion: z.literal(1), updaterVersion: stableVersion, managed: z.literal(true),
    installed, job: jobSchema191.nullable(),
  }).strict(),
  '1.10.1': z.object({
    protocolVersion: z.literal(1), updaterVersion: stableVersion, managed: z.literal(true),
    installed, job: jobSchema1101.nullable(),
  }).strict(),
};
