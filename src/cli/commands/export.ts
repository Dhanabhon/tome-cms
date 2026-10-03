import { rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { packDirectory } from '../archive.js';
import { ContentStepFailure, explainStepFailure, runContentStep, transferRefusal } from '../content-step.js';
import type { CliContext } from '../main.js';
import { formatBytes, printable } from '../output.js';
import { chownTree, findUnsafeEntry, ownerOfBackupRoot } from '../ownership.js';

/**
 * Writes every post and page, with the media they use, to markdown-<time>.tar.gz in the backup root.
 * The installed image's own code reads the site into a fresh directory there; tome packs it with the
 * system tar, checks the archive reads back, hands it to the updater's user, and removes the directory.
 */
export async function exportContent(context: CliContext): Promise<number> {
  const refused = await transferRefusal(context);
  if (refused) {
    context.warn(refused);
    return 1;
  }
  const { config } = context;
  const id = context.requestId();
  // The step makes this directory itself, as the updater's user, and refuses one that is there.
  const work = join(config.backupDirectory, `.work-${id}`);
  const out = join(config.backupDirectory, `markdown-${stamp(context.now())}.tar.gz`);
  let packed = false;
  try {
    const receipt = await runContentStep(context, id, 'export', ['export', '--out', `/work/.work-${id}`]);
    const summary = readSummary(receipt);
    const unsafe = await findUnsafeEntry(work);
    if (unsafe !== null) throw new Error(`The export holds a link or a special file (${printable(unsafe)})`);
    await packDirectory(context, work, out);
    packed = true;
    const check = await context.runCommand('tar', ['-tzf', out], { timeoutMs: 10 * 60_000 });
    if (check.code !== 0) throw new Error('The archive did not read back');
    await chownTree(context.runCommand, out, await ownerOfBackupRoot(config.backupDirectory));
    report(context, out, (await stat(out)).size, summary);
    return 0;
  } catch (error) {
    if (packed) await rm(out, { force: true });
    if (!(error instanceof ContentStepFailure)) throw error;
    await explainStepFailure(context, error, 'export');
    return 1;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** "2026-10-02T12:00:00.000Z" → "20261002T120000000Z", as backups are named. */
function stamp(now: Date): string {
  return now.toISOString().replaceAll('-', '').replaceAll(':', '').replaceAll('.', '');
}

interface Summary { posts: number; pages: number; media: number; formattingNotShown: number }

function readSummary(receipt: Record<string, unknown>): Summary {
  const counts = (receipt.counts ?? {}) as Record<string, unknown>;
  const summary = { posts: counts.posts, pages: counts.pages, media: counts.media, formattingNotShown: receipt.formattingNotShown };
  if (!Object.values(summary).every((count) => Number.isSafeInteger(count) && (count as number) >= 0)) {
    throw new Error('The export step\'s receipt does not read');
  }
  return summary as Summary;
}

function report(context: CliContext, out: string, size: number, summary: Summary): void {
  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  context.print(`Exported to ${out} (${formatBytes(size)}).`);
  context.print(`${plural(summary.posts, 'post', 'posts')}, ${plural(summary.pages, 'page', 'pages')} and ${plural(summary.media, 'media file', 'media files')}.`);
  const formatted = summary.formattingNotShown;
  if (formatted === 1) context.print('1 item carries formatting its .md file cannot show (colour, underline or alignment); its .tome.json file keeps it.');
  if (formatted > 1) context.print(`${formatted} items carry formatting the .md files cannot show (colour, underline or alignment); their .tome.json files keep it.`);
}
