import { readFile } from 'node:fs/promises';

import { compareStableVersions } from '../update/contracts.js';
import { composePrefix } from '../updater/config.js';
import { parseManagedDiagnosticSecrets } from '../updater/process.js';
import type { CliContext } from './main.js';
import { explainContentRefusal, printable, redactionProblem, redactLine, TRANSFER_BUSY } from './output.js';
import { ownerOfBackupRoot } from './ownership.js';
import { isRestoreKeptInMaintenance, isUpdateRunning, readBusy, readRestore, readStatus } from './socket.js';

// The first app whose image carries the export and import steps.
const TRANSFER_APP_SINCE = '1.13.0';
const STEP_MS = 60 * 60_000;
const DIAGNOSTIC_LINES = 20;

/** A step that did not say ok: its receipt's code (null with no receipt), its receipt, and its stderr. */
export class ContentStepFailure extends Error {
  constructor(readonly code: string | null, readonly receipt: Record<string, unknown>, readonly stderr: string) {
    super(`The content step failed (${code ?? 'no receipt'})`);
  }
}

/** Why the site cannot export or import now, or null when it can. */
export async function transferRefusal(context: CliContext): Promise<string | null> {
  const status = await readStatus(context.socket);
  if (compareStableVersions(status.installed.version, TRANSFER_APP_SINCE) < 0) {
    return `This site runs TomeCMS ${printable(status.installed.version)}. Export and import need ${TRANSFER_APP_SINCE} or newer: sudo tome update`;
  }
  // The step itself sees only an update's maintenance; the updater knows of its other jobs. An updater
  // before 1.5.0 cannot say, but its running update shows.
  const busy = await readBusy(context.socket);
  if (busy === true || (busy === null && isUpdateRunning(status.job)) || isRestoreKeptInMaintenance(await readRestore(context.socket))) {
    return TRANSFER_BUSY;
  }
  return null;
}

/**
 * Runs one step of the installed image's content CLI as a one-shot, as the backup root's owner,
 * with the backup root at /work, the way the updater runs a restore's steps. Its receipt when it says
 * ok; a ContentStepFailure otherwise.
 */
export async function runContentStep(context: CliContext, id: string, label: string, step: readonly string[]): Promise<Record<string, unknown>> {
  const { config } = context;
  const owner = await ownerOfBackupRoot(config.backupDirectory);
  const name = `${config.projectName}-tome-${id}-${label}`;
  const result = await context.runCommand('docker', [
    ...composePrefix(config), 'run', '--rm', '--name', name, '--no-deps', '--user', `${owner.uid}:${owner.gid}`,
    '--env', 'DATABASE_QUERY_TIMEOUT_MS=3600000', '--volume', `${config.backupDirectory}:/work`,
    'app', 'npm', 'run', '--silent', 'content', '--', ...step,
  ], { timeoutMs: STEP_MS });
  // A run cut off at its timeout may leave its container behind.
  if (result.timedOut) await context.runCommand('docker', ['rm', '--force', name], { timeoutMs: 30_000 }).catch(() => undefined);
  const lines = result.stdout.split('\n').filter(Boolean);
  let receipt: unknown = null;
  try {
    receipt = lines.length === 1 ? JSON.parse(lines[0]!) : null;
  } catch { /* no receipt */ }
  const record = receipt !== null && typeof receipt === 'object' && !Array.isArray(receipt) ? receipt as Record<string, unknown> : {};
  if (result.code === 0 && record.ok === true) return record;
  throw new ContentStepFailure(record.ok === false && typeof record.code === 'string' ? record.code : null, record, result.stderr);
}

/** Tells the owner why a step failed: its refusal's sentence, or what it printed, with every secret hidden. */
export async function explainStepFailure(context: CliContext, failure: ContentStepFailure, step: 'export' | 'import'): Promise<void> {
  const nothing = `nothing was ${step}ed`;
  const sentence = failure.code === null ? null : explainContentRefusal(failure.code, failure.receipt);
  if (sentence) {
    context.warn(sentence);
    if (!sentence.endsWith(`${nothing}.`)) context.warn(`Nothing was ${step}ed.`);
    return;
  }
  const code = failure.code === null ? '' : ` (${printable(failure.code)})`;
  const lines = await hiddenSecrets(context).then(
    (secrets) => failure.stderr.split('\n').filter((line) => line.trim()).slice(-DIAGNOSTIC_LINES).map((line) => `  ${printable(redactLine(line, secrets))}`),
    () => ['  (not shown: the secrets in it could not be hidden)'],
  );
  context.warn(`The ${step} step failed${code}, so ${nothing}.${lines.length ? ' What it said:' : ''}`);
  for (const line of lines) context.warn(line);
}

/** The secrets in the server's environment, as `tome logs` hides them. It throws when it cannot. */
async function hiddenSecrets(context: CliContext): Promise<string[]> {
  const secrets = parseManagedDiagnosticSecrets(await readFile(context.config.environmentFile, 'utf8'), {});
  if (redactionProblem(secrets)) throw new Error('Secrets that cannot be hidden');
  return secrets;
}
