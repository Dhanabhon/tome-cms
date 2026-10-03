import { mkdir, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { ArchiveRefusal, assertSafeEntries, extractArchive, listArchive } from '../archive.js';
import { ContentStepFailure, explainStepFailure, runContentStep, transferRefusal } from '../content-step.js';
import type { CliContext } from '../main.js';
import { printable } from '../output.js';
import { chownTree, findUnsafeEntry, inBackupRoot, ownerOfBackupRoot } from '../ownership.js';

/** The import step's plan, as its receipt gives it. Every string in it came from the archive. */
interface ImportPlan {
  create: Array<{ kind: string; locale: string; path: string }>;
  skip: Array<{ path: string }>;
  media: { upload: number; reuse: number };
  categoriesToCreate: string[];
  groupsSplit: Array<{ translation: string; skipped: string[] }>;
}

/**
 * Adds the posts and pages in an archive from `tome export`, or a directory laid out the same way,
 * through the installed image's own import. The archive is listed and checked before it is unpacked
 * into a fresh directory in the backup root, which is removed whatever happens.
 */
export async function importContent(context: CliContext, options: { path: string; dryRun: boolean; yes: boolean }): Promise<number> {
  const { config } = context;
  let input: Awaited<ReturnType<typeof inBackupRoot>>;
  try {
    input = await inBackupRoot(config.backupDirectory, options.path);
  } catch {
    input = { real: '', isDirectory: false, isFile: false };
  }
  if (!input.isDirectory && !input.isFile) {
    context.warn('That archive is not under /var/backups/tome-cms.');
    return 1;
  }
  const refused = await transferRefusal(context);
  if (refused) {
    context.warn(refused);
    return 1;
  }
  const id = context.requestId();
  const work = join(config.backupDirectory, `.work-${id}`);
  let applying = false;
  try {
    const directory = input.isFile ? await unpack(context, input.real, work) : await checked(input.real);
    await chownTree(context.runCommand, directory, await ownerOfBackupRoot(config.backupDirectory));
    const step = ['import', '--dir', `/work/${basename(directory)}`];
    const plan = readPlan((await runContentStep(context, id, 'import-plan', [...step, '--plan'])).plan);
    context.print(`${input.isFile ? 'Archive' : 'Directory'}: ${printable(input.real)}`);
    if (plan.create.length === 0) {
      context.print('Nothing to import: everything in it is already on the site.');
      return 0;
    }
    printPlan(context, plan);
    if (options.dryRun) return 0;
    if (!options.yes && !await context.confirm('Import these? [y/N] ')) {
      context.print('Nothing was done.');
      return 1;
    }
    applying = true;
    const result = (await runContentStep(context, id, 'import-apply', [...step, '--apply'])).result;
    let summary: ImportPlan;
    try {
      summary = readPlan(result);
    } catch {
      context.warn('The import finished, but tome could not read its summary. See what it added in the admin.');
      return 0;
    }
    printResult(context, summary, (result as { missingMedia?: unknown }).missingMedia);
    return 0;
  } catch (error) {
    if (error instanceof ArchiveRefusal) {
      context.warn(error.message);
      return 1;
    }
    if (!(error instanceof ContentStepFailure)) throw error;
    await explainStepFailure(context, error, 'import', applying);
    return 1;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/**
 * Lists and checks the archive, then unpacks it into `work`, made here as root's own and only then
 * handed over, so the updater's user never sees it half-written. Every file 0600, every directory 0700.
 */
async function unpack(context: CliContext, archive: string, work: string): Promise<string> {
  const entries = await listArchive(context, archive);
  assertSafeEntries(entries);
  await mkdir(work, { mode: 0o700 });
  await extractArchive(context, archive, work, entries);
  // Unpacked without the archive's permission bits, but a file it made unreadable must still be read.
  const result = await context.runCommand('chmod', ['-R', 'u=rwX,go=', work], { timeoutMs: 10 * 60_000 });
  if (result.code !== 0) throw new Error(`chmod exited with ${result.code}`);
  return work;
}

/** A directory given as it is, with the same walk an unpacked archive gets. */
async function checked(directory: string): Promise<string> {
  const unsafe = await findUnsafeEntry(directory);
  if (unsafe !== null) throw new ArchiveRefusal(`That archive holds a link or a special file (${printable(unsafe)}), so nothing was imported.`);
  return directory;
}

const isText = (value: unknown): value is string => typeof value === 'string';
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

function readPlan(value: unknown): ImportPlan {
  const plan = value as Partial<ImportPlan> | null;
  const readable = Array.isArray(plan?.create) && plan.create.every((item) => isText(item?.kind) && isText(item.locale) && isText(item.path)) &&
    Array.isArray(plan.skip) && plan.skip.every((item) => isText(item?.path)) &&
    isCount(plan.media?.upload) && isCount(plan.media.reuse) &&
    Array.isArray(plan.categoriesToCreate) && plan.categoriesToCreate.every(isText) &&
    Array.isArray(plan.groupsSplit) && plan.groupsSplit.every((group) => isText(group?.translation) && Array.isArray(group.skipped) && group.skipped.every(isText));
  if (!readable) throw new Error('The import step\'s plan does not read');
  return plan as ImportPlan;
}

const languages: Record<string, string> = { en: 'English', th: 'Thai' };

/** "2 posts in English, 1 post in Thai and 1 page in English". */
function created(plan: ImportPlan): string {
  const counts = new Map<string, number>();
  for (const { kind, locale } of plan.create) counts.set(`${kind}\n${locale}`, (counts.get(`${kind}\n${locale}`) ?? 0) + 1);
  const parts = [...counts].map(([key, count]) => {
    const [kind, locale] = key.split('\n') as [string, string];
    return `${count} ${printable(kind)}${count === 1 ? '' : 's'} in ${Object.hasOwn(languages, locale) ? languages[locale] : printable(locale)}`;
  });
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0] ?? 'nothing';
}

function printPlan(context: CliContext, plan: ImportPlan): void {
  context.print(`To create: ${created(plan)}.`);
  if (plan.skip.length) {
    context.print('Skipped, because the address is already taken (nothing is overwritten):');
    for (const { path } of plan.skip) context.print(`  ${printable(path)}`);
  }
  context.print(`Media: ${plan.media.upload} file${plan.media.upload === 1 ? '' : 's'} to upload, ${plan.media.reuse} already on the site.`);
  if (plan.categoriesToCreate.length) context.print(`Categories to create: ${plan.categoriesToCreate.map(printable).join(', ')}.`);
  if (plan.groupsSplit.length) {
    context.print('These translations had an edition skipped, so the rest form a group without it:');
    for (const group of plan.groupsSplit) context.print(`  ${printable(group.translation)}: ${group.skipped.map(printable).join(', ')}`);
  }
}

function printResult(context: CliContext, result: ImportPlan, missingMedia: unknown): void {
  context.print(`Created ${created(result)}.`);
  if (result.skip.length) context.print(`Skipped ${result.skip.length}, whose address${result.skip.length === 1 ? ' was' : 'es were'} already taken.`);
  context.print(`Media: ${result.media.upload} uploaded, ${result.media.reuse} reused.`);
  if (result.categoriesToCreate.length) context.print(`Categories created: ${result.categoriesToCreate.map(printable).join(', ')}.`);
  if (isCount(missingMedia) && missingMedia > 0) {
    context.print(missingMedia === 1
      ? '1 file the content named was not in the archive; it shows as a line saying it is missing.'
      : `${missingMedia} files the content named were not in the archive; each shows as a line saying it is missing.`);
  }
}
