import type { PruneResult } from '../../updater/prune.js';
import type { CliContext } from '../main.js';
import { formatBytes } from '../output.js';
import { postJob, refusal } from '../socket.js';

/** The updater's clean-up of old application images: a dry run unless --yes. */
export async function prune(context: CliContext, options: { yes: boolean }): Promise<number> {
  const answer = await postJob(context.socket, context.sleep, '/v1/prune', { dryRun: !options.yes });
  if (answer.status === 503) {
    context.warn('Docker\'s image list could not be read in full, so nothing was removed. Check Docker with: sudo systemctl status docker');
    return 1;
  }
  if (answer.status !== 200) {
    context.warn(await refusal(context.socket, answer) ?? `The updater refused the clean-up (${answer.status}).`);
    return 1;
  }
  const { candidates, removed } = answer.body as PruneResult;
  if (candidates.length === 0) {
    context.print('No old application images to remove.');
    return 0;
  }
  const line = (image: PruneResult['candidates'][number]) => `${image.id.slice(0, 'sha256:'.length + 12)}  ${image.size === null ? 'size unknown' : formatBytes(image.size)}`;
  // Docker's sizes are rounded, so a total is "about".
  const total = (images: PruneResult['candidates']) => formatBytes(images.reduce((sum, image) => sum + (image.size ?? 0), 0));
  if (!options.yes) {
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
