import { realpathSync } from 'node:fs';
import { mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

/*
 * The content CLI the app image carries (dist/server/content-cli.mjs, `npm run content`). The
 * updater runs each step as a one-shot of the installed image, and reads exactly one JSON line
 * from stdout as its receipt; stderr may carry diagnostics and is never parsed. Nothing loads the
 * environment until a step that needs it does, so `self-test` runs in the image build.
 */

export type ContentStep =
  | { step: 'self-test' }
  | { step: 'restore-database'; dump: string }
  | { step: 'restore-objects'; backup: string }
  | { step: 'after-restore' }
  | { step: 'export'; out: string }
  | { step: 'import'; dir: string; mode: 'plan' | 'apply' }
  | { step: 'orphans'; execute: boolean };

class UsageError extends Error {}

/** A refusal or failure the receipt names by its code, with what it is about. */
class StepError extends Error {
  constructor(readonly code: string, readonly detail: Record<string, string> = {}) {
    super(code);
  }
}

export function parseContentArgs(argv: string[]): ContentStep {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv, allowPositionals: true, strict: true,
      options: {
        backup: { type: 'string' }, dump: { type: 'string' }, out: { type: 'string' }, dir: { type: 'string' },
        plan: { type: 'boolean' }, apply: { type: 'boolean' }, execute: { type: 'boolean' },
      },
    });
  } catch {
    throw new UsageError('usage');
  }
  const { positionals, values } = parsed;
  const given = Object.keys(values);
  const only = (option?: 'backup' | 'dump' | 'out') => positionals.length === 1 &&
    given.length === (option ? 1 : 0) && (!option || Boolean(values[option]));
  const step = positionals[0];
  if (step === 'self-test' && only()) return { step };
  if (step === 'after-restore' && only()) return { step };
  if (step === 'restore-database' && only('dump')) return { step, dump: values.dump! };
  if (step === 'restore-objects' && only('backup')) return { step, backup: values.backup! };
  if (step === 'export' && only('out')) return { step, out: values.out! };
  if (step === 'orphans' && positionals.length === 1 && (only() || (given.length === 1 && values.execute))) {
    return { step, execute: values.execute === true };
  }
  // Exactly one of --plan and --apply, beside the directory.
  if (step === 'import' && positionals.length === 1 && given.length === 2 && values.dir && (values.plan || values.apply)) {
    return { step, dir: values.dir, mode: values.plan ? 'plan' : 'apply' };
  }
  throw new UsageError('usage');
}

const WORK = '/work';

function insideWork(path: string, work = WORK): boolean {
  const within = relative(work, path);
  return within !== '' && within !== '..' && !within.startsWith(`..${sep}`) && !isAbsolute(within);
}

/** A backup reaches a one-shot only through its /work volume: no path may lead outside it, by `..` or by a link. */
async function workPath(path: string, work = WORK): Promise<string> {
  if (!isAbsolute(path) || !insideWork(resolve(path), work)) throw new StepError('path_outside_work');
  const real = await realpath(path);
  if (!insideWork(real, work)) throw new StepError('path_outside_work');
  return real;
}

type Receipt = Record<string, unknown>;

/**
 * Closes what a step opened. A step that returned has done its work, and an import's has been
 * committed, so a close that fails then is only logged: the receipt still says ok. After a step
 * that threw, the step's own error is the one reported.
 */
export async function closeQuietly(close: () => Promise<void>): Promise<void> {
  try {
    await close();
  } catch (error) {
    console.error(`Error: the database did not close: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function restoreDatabase(dump: string): Promise<Receipt> {
  const path = await workPath(dump);
  if (!(await stat(path)).isFile()) throw new StepError('backup_invalid');
  const { getServerEnv } = await import('../env');
  const { resetAndRestoreDatabase } = await import('./restore-steps');
  await resetAndRestoreDatabase(getServerEnv().DATABASE_URL, path);
  return {};
}

async function restoreObjects(backup: string): Promise<Receipt> {
  const directory = await workPath(backup);
  const { parseBackupManifest } = await import('../../update/backup');
  const { backupFile, restoredDocumentDispositions, syncBucketToManifest } = await import('./restore-steps');
  const manifest = parseBackupManifest(JSON.parse(await readFile(await backupFile(directory, 'manifest.json'), 'utf8')));
  // A database-only backup lists no objects; making the bucket equal it would empty the library.
  if (manifest.scope === 'database') throw new StepError('database_only_backup');
  const { closeDatabase } = await import('../db/client');
  const { s3, s3Bucket } = await import('../media/storage');
  try {
    const dispositions = await restoredDocumentDispositions();
    return await syncBucketToManifest(s3, s3Bucket, directory, manifest, dispositions);
  } finally {
    s3.destroy();
    await closeQuietly(closeDatabase);
  }
}

async function afterRestore(): Promise<Receipt> {
  const { afterRestoreReport } = await import('./restore-steps');
  const { closeDatabase } = await import('../db/client');
  try {
    return { ...await afterRestoreReport() };
  } finally {
    await closeQuietly(closeDatabase);
  }
}

/** An export makes its own directory directly in /work, so nothing it writes can reach through a link. */
export async function createOutDirectory(out: string, work = WORK): Promise<string> {
  if (!isAbsolute(out) || dirname(resolve(out)) !== work) throw new StepError('path_outside_work');
  try {
    await mkdir(out, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new StepError('out_exists');
    throw error;
  }
  return workPath(out, work);
}

async function exportContent(out: string): Promise<Receipt> {
  const directory = await createOutDirectory(out);
  const { exportSite, MediaMissingError } = await import('./export');
  const { closeDatabase } = await import('../db/client');
  const { s3 } = await import('../media/storage');
  try {
    return { ...await exportSite(directory) };
  } catch (error) {
    if (error instanceof MediaMissingError) throw new StepError(error.code, { mediaId: error.mediaId });
    throw error;
  } finally {
    s3.destroy();
    await closeQuietly(closeDatabase);
  }
}

export async function importContent(dir: string, mode: 'plan' | 'apply', work = WORK): Promise<Receipt> {
  const directory = await workPath(dir, work);
  if (!(await stat(directory)).isDirectory()) throw new StepError('layout_invalid');
  const { isUpdateWriteBlocked } = await import('../update/maintenance');
  // The updater's status file, mounted into every app container, says when an update is writing.
  // tome asks the updater's /v1/busy before it starts this step, for its other jobs.
  if (await isUpdateWriteBlocked()) throw new StepError('site_busy');
  const { ArchiveInputError } = await import('./archive-format');
  const { closeDatabase, db } = await import('../db/client');
  const { s3 } = await import('../media/storage');
  try {
    const settings = await db.selectFrom('site_settings').select('owner_id').where('id', '=', true).executeTakeFirst();
    if (!settings) throw new StepError('site_not_installed');
    if (mode === 'plan') {
      const { planImport } = await import('./import-plan');
      return { plan: await planImport(directory, settings.owner_id) };
    }
    const { applyImport } = await import('./import-apply');
    return { result: await applyImport(directory, settings.owner_id) };
  } catch (error) {
    if (error instanceof ArchiveInputError) throw new StepError(error.code, { file: error.file, ...(error.field ? { field: error.field } : {}) });
    throw error;
  } finally {
    // Each picture's smaller copies are queued behind it, also when the import fails after it was
    // queued; closing first would fail every one. A failure here never hides the import's own.
    try {
      await (await import('../media/variants')).variantsIdle();
    } catch (error) {
      console.error(`Error: the image copies did not finish: ${error instanceof Error ? error.message : String(error)}`);
    }
    s3.destroy();
    await closeQuietly(closeDatabase);
  }
}

/** Lists the media objects nothing points at, and with `execute` deletes them. */
async function orphans(execute: boolean): Promise<Receipt> {
  const { sweepOrphans } = await import('../media/orphans');
  const { closeDatabase, db } = await import('../db/client');
  const { s3, s3Bucket } = await import('../media/storage');
  try {
    return { ...await sweepOrphans({ storage: s3, bucket: s3Bucket, database: db, execute }) };
  } finally {
    s3.destroy();
    await closeQuietly(closeDatabase);
  }
}

async function selfTest(): Promise<Receipt> {
  // Loads every package the steps use, without the environment, so the build fails on a missing one.
  const steps = await import('./restore-steps');
  if (typeof steps.syncBucketToManifest !== 'function') throw new StepError('self_test_failed');
  const { exportSite } = await import('./export');
  if (typeof exportSite !== 'function') throw new StepError('self_test_failed');
  const { applyImport } = await import('./import-apply');
  if (typeof applyImport !== 'function') throw new StepError('self_test_failed');
  const { sweepOrphans } = await import('../media/orphans');
  if (typeof sweepOrphans !== 'function') throw new StepError('self_test_failed');
  const { step } = parseContentArgs(['restore-objects', '--backup', `${WORK}/backup`]);
  if (step !== 'restore-objects') throw new StepError('self_test_failed');
  return {};
}

function run(step: ContentStep): Promise<Receipt> {
  switch (step.step) {
    case 'self-test': return selfTest();
    case 'restore-database': return restoreDatabase(step.dump);
    case 'restore-objects': return restoreObjects(step.backup);
    case 'after-restore': return afterRestore();
    case 'export': return exportContent(step.out);
    case 'import': return importContent(step.dir, step.mode);
    case 'orphans': return orphans(step.execute);
  }
}

const SNAKE_CASE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/** The receipt names an error by its own code when that is one of ours; never by its message. */
function failureCode(error: unknown, step: string): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && SNAKE_CASE.test(code) ? code : `${step.replace(/-/g, '_')}_failed`;
}

async function main(argv: string[]): Promise<void> {
  let step: ContentStep;
  try {
    step = parseContentArgs(argv);
  } catch {
    process.stdout.write(`${JSON.stringify({ ok: false, code: 'usage' })}\n`);
    process.exitCode = 2;
    return;
  }
  try {
    const receipt = await run(step);
    process.stdout.write(`${JSON.stringify({ ok: true, ...receipt })}\n`);
  } catch (error) {
    if (!(error instanceof StepError)) console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    const detail = error instanceof StepError ? error.detail : {};
    process.stdout.write(`${JSON.stringify({ ok: false, code: failureCode(error, step.step), ...detail })}\n`);
    process.exitCode = 1;
  }
}

/** A path by its real path, or as given when it has none: `node -e` passes along any argument. */
function realOrGiven(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

// Node runs a module by its real path, so a link to the bundle still counts as starting it.
if (process.argv[1] && import.meta.url === pathToFileURL(realOrGiven(process.argv[1])).href) {
  await main(process.argv.slice(2));
}
