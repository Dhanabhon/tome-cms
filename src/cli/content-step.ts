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
const RECEIPT_BYTES = 16 * 1024 ** 2;

/**
 * A step that did not say ok. Either it refused, and its receipt names the code, or tome could not
 * read its receipt, and `unreadable` says why. With its last lines of stderr.
 */
export class ContentStepFailure extends Error {
  constructor(readonly code: string | null, readonly receipt: Record<string, unknown>, readonly stderr: readonly string[], readonly unreadable: string | null) {
    super(`The content step failed (${code ?? unreadable})`);
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
  // Read line by line: a plan names every item, far past runCommand's 32 KiB. Past the bound, lines
  // are dropped, never the step: stopping an import half-way is worse than not reading its answer.
  const stdout: string[] = [];
  const stderr: string[] = [];
  let bytes = 0;
  const code = await context.streamCommand('docker', [
    ...composePrefix(config), 'run', '--rm', '--name', name, '--no-deps', '--user', `${owner.uid}:${owner.gid}`,
    '--env', 'DATABASE_QUERY_TIMEOUT_MS=3600000', '--volume', `${config.backupDirectory}:/work`,
    'app', 'npm', 'run', '--silent', 'content', '--', ...step,
  ], (line, stream) => {
    if (stream === 'stderr') {
      if (line.trim()) stderr.push(line);
      if (stderr.length > DIAGNOSTIC_LINES) stderr.shift();
      return;
    }
    bytes += Buffer.byteLength(line) + 1;
    if (bytes <= RECEIPT_BYTES && line.trim()) stdout.push(line);
  }, { timeoutMs: STEP_MS });
  const { record, unreadable } = readReceipt(stdout, bytes);
  if (code === 0 && record.ok === true) return record;
  const refused = record.ok === false && typeof record.code === 'string' ? record.code : null;
  // A run cut off, at its timeout or otherwise, may leave its container behind.
  if (!refused) await context.runCommand('docker', ['rm', '--force', name], { timeoutMs: 30_000 }).catch(() => undefined);
  throw new ContentStepFailure(refused, record, stderr, refused ? null : unreadable ?? `it exited with ${code}`);
}

/** Exactly one JSON object on one line, or why not. */
function readReceipt(lines: readonly string[], bytes: number): { record: Record<string, unknown>; unreadable: string | null } {
  const none = (unreadable: string) => ({ record: {}, unreadable });
  if (bytes > RECEIPT_BYTES) return none('it was longer than 16 MiB');
  if (lines.length === 0) return none('it gave none');
  if (lines.length > 1) return none('it gave more than one line');
  let value: unknown;
  try {
    value = JSON.parse(lines[0]!);
  } catch {
    return none('it was cut off, or is not JSON');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return none('it is not a receipt');
  return { record: value as Record<string, unknown>, unreadable: null };
}

/**
 * Tells the owner why a step failed: its refusal's sentence, or what it printed, with every secret
 * hidden. After an import's apply step, an answer tome cannot read never says nothing was imported.
 */
export async function explainStepFailure(context: CliContext, failure: ContentStepFailure, step: 'export' | 'import', applying = false): Promise<void> {
  const nothing = `nothing was ${step}ed`;
  const sentence = failure.code === null ? null : explainContentRefusal(failure.code, failure.receipt);
  if (sentence) {
    context.warn(sentence);
    if (!sentence.endsWith(`${nothing}.`)) context.warn(`Nothing was ${step}ed.`);
    return;
  }
  const lines = await hiddenSecrets(context).then(
    (secrets) => failure.stderr.map((line) => `  ${printable(redactLine(line, secrets))}`),
    () => ['  (not shown: the secrets in it could not be hidden)'],
  );
  const said = lines.length ? ' What it said:' : '';
  if (failure.code !== null) {
    context.warn(`The ${step} step failed (${printable(failure.code)}), so ${nothing}.${said}`);
  } else if (applying) {
    context.warn(`The import ran, but tome could not read its answer (${failure.unreadable}), so it may have finished. ` +
      `Check the posts and pages in the admin, or run the same import with --dry-run to see what is still to import.${said}`);
  } else {
    context.warn(`The ${step} step failed, and tome could not read its answer (${failure.unreadable}).${said}`);
  }
  for (const line of lines) context.warn(line);
}

/** The secrets in the server's environment, as `tome logs` hides them. It throws when it cannot. */
async function hiddenSecrets(context: CliContext): Promise<string[]> {
  const secrets = parseManagedDiagnosticSecrets(await readFile(context.config.environmentFile, 'utf8'), {});
  if (redactionProblem(secrets)) throw new Error('Secrets that cannot be hidden');
  return secrets;
}
