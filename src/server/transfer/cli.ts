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
  | { step: 'export'; out: string };

class UsageError extends Error {}

/** A refusal or failure the receipt names by its code. */
class StepError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export function parseContentArgs(argv: string[]): ContentStep {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv, allowPositionals: true, strict: true,
      options: { backup: { type: 'string' }, dump: { type: 'string' }, out: { type: 'string' } },
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
  throw new UsageError('usage');
}

const WORK = '/work';

function insideWork(path: string): boolean {
  const within = relative(WORK, path);
  return within !== '' && within !== '..' && !within.startsWith(`..${sep}`) && !isAbsolute(within);
}

/** A backup reaches a one-shot only through its /work volume: no path may lead outside it, by `..` or by a link. */
async function workPath(path: string): Promise<string> {
  if (!isAbsolute(path) || !insideWork(resolve(path))) throw new StepError('path_outside_work');
  const real = await realpath(path);
  if (!insideWork(real)) throw new StepError('path_outside_work');
  return real;
}

type Receipt = Record<string, unknown>;

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
    await closeDatabase();
  }
}

async function afterRestore(): Promise<Receipt> {
  const { afterRestoreReport } = await import('./restore-steps');
  const { closeDatabase } = await import('../db/client');
  try {
    return { ...await afterRestoreReport() };
  } finally {
    await closeDatabase();
  }
}

/** The step makes its own directory directly in /work, so nothing it writes can reach through a link. */
async function exportContent(out: string): Promise<Receipt> {
  if (!isAbsolute(out) || dirname(resolve(out)) !== WORK) throw new StepError('path_outside_work');
  try {
    await mkdir(out, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new StepError('out_exists');
    throw error;
  }
  const directory = await workPath(out);
  const { exportSite } = await import('./export');
  const { closeDatabase } = await import('../db/client');
  const { s3 } = await import('../media/storage');
  try {
    return { ...await exportSite(directory) };
  } finally {
    s3.destroy();
    await closeDatabase();
  }
}

async function selfTest(): Promise<Receipt> {
  // Loads every package the steps use, without the environment, so the build fails on a missing one.
  const steps = await import('./restore-steps');
  if (typeof steps.syncBucketToManifest !== 'function') throw new StepError('self_test_failed');
  const { exportSite } = await import('./export');
  if (typeof exportSite !== 'function') throw new StepError('self_test_failed');
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
    process.stdout.write(`${JSON.stringify({ ok: false, code: failureCode(error, step.step) })}\n`);
    process.exitCode = 1;
  }
}

// Node runs a module by its real path, so a link to the bundle still counts as starting it.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  await main(process.argv.slice(2));
}
