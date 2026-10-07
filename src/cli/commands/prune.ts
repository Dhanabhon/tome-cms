import { compareStableVersions } from '../../update/contracts.js';
import type { PruneResult } from '../../updater/prune.js';
import { ContentStepFailure, runContentStep, stepDiagnostics, transferRefusal } from '../content-step.js';
import type { CliContext } from '../main.js';
import { formatBytes, printable } from '../output.js';
import { postJob, readStatus, refusal } from '../socket.js';

// The first app whose image carries the sweep of media files nothing points at.
const ORPHANS_APP_SINCE = '1.21.0';

/**
 * The updater's clean-up of old application images, a dry run unless --yes; then the image's sweep
 * of media files nothing points at, a dry run unless --orphans.
 */
export async function prune(context: CliContext, options: { yes: boolean; orphans: boolean }): Promise<number> {
  const images = await pruneImages(context, options.yes);
  // A refusal means the updater is busy; the sweep would only say so again.
  if (images === 'refused') return 1;
  return Math.max(images, await sweep(context, options.orphans));
}

async function pruneImages(context: CliContext, yes: boolean): Promise<number | 'refused'> {
  const answer = await postJob(context.socket, context.sleep, '/v1/prune', { dryRun: !yes });
  if (answer.status === 503) {
    context.warn('Docker\'s image list could not be read in full, so nothing was removed. Check Docker with: sudo systemctl status docker');
    return 1;
  }
  if (answer.status !== 200) {
    context.warn(await refusal(context.socket, answer) ?? `The updater refused the clean-up (${answer.status}).`);
    return 'refused';
  }
  const { candidates, removed } = answer.body as PruneResult;
  if (candidates.length === 0) {
    context.print('No old application images to remove.');
    return 0;
  }
  const line = (image: PruneResult['candidates'][number]) => `${image.id.slice(0, 'sha256:'.length + 12)}  ${image.size === null ? 'size unknown' : formatBytes(image.size)}`;
  // Docker's sizes are rounded, so a total is "about".
  const total = (images: PruneResult['candidates']) => formatBytes(images.reduce((sum, image) => sum + (image.size ?? 0), 0));
  if (!yes) {
    context.print('These old application images can go:');
    for (const image of candidates) context.print(`  ${line(image)}`);
    context.print(`Total: about ${total(candidates)}.`);
    context.print('Remove them with: sudo tome prune --yes');
    return 0;
  }
  const gone = candidates.filter((image) => removed.includes(image.id));
  for (const image of gone) context.print(`Removed ${line(image)}`);
  context.print(`Freed about ${total(gone)}.`);
  const kept = candidates.length - gone.length;
  if (kept) context.print(`${kept} image${kept === 1 ? '' : 's'} could not be removed; a stopped container may still use ${kept === 1 ? 'it' : 'them'}.`);
  return 0;
}

interface Sweep { count: number; bytes: number; keys: string[]; deleted: number; failed: number; kept: number }

/** Runs the installed image's sweep as a one-shot: a dry run, or with `execute` the deletes. */
async function sweep(context: CliContext, execute: boolean): Promise<number> {
  const { installed } = await readStatus(context.socket);
  if (compareStableVersions(installed.version, ORPHANS_APP_SINCE) < 0) {
    if (!execute) return 0;
    context.warn(`This site runs TomeCMS ${printable(installed.version)}. Deleting media files nothing points at needs ${ORPHANS_APP_SINCE} or newer: sudo tome update`);
    return 1;
  }
  // A dry run that could not look says why, and leaves prune's answer to the images.
  const failed = execute ? 1 : 0;
  const refused = await transferRefusal(context);
  if (refused) {
    context.warn(refused);
    return failed;
  }
  let result: Sweep | null;
  try {
    result = readSweep(await runContentStep(context, context.requestId(), 'orphans', execute ? ['orphans', '--execute'] : ['orphans']));
  } catch (error) {
    if (!(error instanceof ContentStepFailure)) throw error;
    explainSweepFailure(context, execute, error.code ?? error.unreadable ?? 'unknown', await stepDiagnostics(context, error));
    return failed;
  }
  if (!result) {
    explainSweepFailure(context, execute, 'its answer does not read', []);
    return failed;
  }
  if (!result.count) {
    context.print('No media files are left with nothing pointing at them.');
    return 0;
  }
  const plural = (count: number) => `${count} media file${count === 1 ? '' : 's'}`;
  if (!execute) {
    context.print('These media files are over a day old, and nothing on the site points at them:');
    for (const key of result.keys) context.print(`  ${printable(key)}`);
    if (result.count > result.keys.length) context.print(`  and ${result.count - result.keys.length} more`);
    context.print(`Total: ${result.count} file${result.count === 1 ? '' : 's'}, ${formatBytes(result.bytes)}.`);
    context.print('Delete them with: sudo tome prune --orphans');
    return 0;
  }
  context.print(`Deleted ${plural(result.deleted)} nothing pointed at.`);
  if (result.kept) context.print(`${result.kept} came into use while it ran, so ${result.kept === 1 ? 'it was' : 'they were'} kept.`);
  if (!result.failed) return 0;
  context.warn(`${result.failed} could not be deleted. Run sudo tome prune --orphans again.`);
  return 1;
}

function explainSweepFailure(context: CliContext, execute: boolean, reason: string, lines: readonly string[]): void {
  const said = lines.length ? ' What it said:' : '';
  context.warn(execute
    ? `The sweep of media files nothing points at failed (${printable(reason)}). It may have deleted some before it stopped; run sudo tome prune --orphans again.${said}`
    : `The check for media files nothing points at failed (${printable(reason)}), so nothing was deleted.${said}`);
  for (const line of lines) context.warn(line);
}

function readSweep(receipt: Record<string, unknown>): Sweep | null {
  const counts = ['count', 'bytes', 'deleted', 'failed', 'kept'] as const;
  if (!counts.every((name) => Number.isSafeInteger(receipt[name]) && (receipt[name] as number) >= 0)) return null;
  if (!Array.isArray(receipt.keys) || !receipt.keys.every((key) => typeof key === 'string')) return null;
  return receipt as unknown as Sweep;
}
