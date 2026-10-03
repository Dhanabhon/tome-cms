// Replaces the managed updater with the one in this checkout, and nothing else.
//
// The updater runs on the host and is built once, when the server is installed. Updating from
// "System" replaces the application image only, so a server keeps the updater it was installed
// with until this is run. Run it as root from a clean checkout of the release tag, after `npm ci`:
//   sudo npm run updater:upgrade
// It leaves the site running. It refuses while an update, a backup or a restore is in progress,
// keeps the previous updater beside the new one, and puts it back if the new one does not answer. It
// brings `tome` too: the CLI is built with the updater, and its shim goes on the PATH.
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { chmod, cp, lstat, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';

import { TOME_SHIM, TOME_SHIM_MARKER, TOME_SHIM_PATH, UPDATER_INSTALL_DIRECTORY } from '../src/cli/shim.ts';
import { compareStableVersions } from '../src/update/contracts.ts';
import { parseUpdaterConfig } from '../src/updater/config.ts';
import { createUpdaterStateStore } from '../src/updater/state.ts';
import { UPDATER_VERSION } from '../src/updater/version.ts';

const INSTALL_DIRECTORY = UPDATER_INSTALL_DIRECTORY;
const SERVICE_FILE = '/etc/systemd/system/tomecms-updater.service';
const TERMINAL = new Set(['succeeded', 'rolled_back', 'failed_manual_recovery']);
const BACKUP_TERMINAL = new Set(['succeeded', 'failed']);

export interface UpgradeCheck {
  root: boolean;
  /** `git describe --exact-match` of HEAD, or '' when HEAD carries no tag. */
  tag: string;
  packageVersion: string;
  clean: boolean;
  /** The phase of the updater's last job, or null when it has none. */
  jobPhase: string | null;
  /** The phase of the last backup on request, or null when there has been none. */
  backupPhase: string | null;
  /** The phase of the last restore, or null when there has been none. */
  restorePhase: string | null;
  /** The version the running updater reports. */
  running: string;
}

/** Why this upgrade must not run, or null when it may. */
export function upgradeRefusal(check: UpgradeCheck): string | null {
  if (!check.root) return 'Run this as root, for example with sudo.';
  if (check.tag !== `v${check.packageVersion}`) return 'Run this from a checkout of the exact release tag, such as v1.3.0.';
  if (!check.clean) return 'The checkout has changes. Run this from a clean checkout of the release tag.';
  if (check.jobPhase !== null && !TERMINAL.has(check.jobPhase)) return 'An update is in progress. Wait for it to finish, then run this again.';
  if (check.backupPhase !== null && !BACKUP_TERMINAL.has(check.backupPhase)) return backupInProgress;
  if (check.restorePhase !== null && !BACKUP_TERMINAL.has(check.restorePhase)) return restoreInProgress;
  if (compareStableVersions(check.running, UPDATER_VERSION) > 0) return `The running updater (${check.running}) is newer than this checkout's (${UPDATER_VERSION}).`;
  return null;
}

const restoreInProgress = 'A restore is in progress. Wait for it to finish, then run this again. If sudo tome status says it is stuck, follow what it says first.';
const backupInProgress = 'A backup is in progress. Wait for it to finish, then run this again. If sudo tome status says it is stuck, follow what it says first.';

const repository = fileURLToPath(new URL('..', import.meta.url));

function run(command: string, args: string[], options: { quiet?: boolean } = {}): string {
  const result = spawnSync(command, args, { cwd: repository, encoding: 'utf8', stdio: options.quiet ? 'pipe' : ['ignore', 'pipe', 'inherit'] });
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed.`);
  return result.stdout.trim();
}

function tagOfHead(): string {
  const result = spawnSync('git', ['describe', '--tags', '--exact-match', 'HEAD'], { cwd: repository, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

function socketStatus(socketPath: string): Promise<{ updaterVersion?: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, path: '/v1/status', method: 'GET', timeout: 2_000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (error) { reject(error); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('The updater did not answer.')));
    req.on('error', reject);
    req.end();
  });
}

async function answers(socketPath: string, version: string): Promise<boolean> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      if ((await socketStatus(socketPath)).updaterVersion === version) return true;
    } catch {
      // Still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return false;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const configPath = process.argv.slice(2).find((argument) => !argument.startsWith('--')) ?? '/etc/tome-cms/updater.json';
  const config = parseUpdaterConfig(JSON.parse(await readFile(configPath, 'utf8')));
  const packageVersion = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8')).version as string;
  // An updater that does not answer is the one to replace; it is treated as the first release.
  const running = await socketStatus(config.socketPath).then((status) => status.updaterVersion ?? '1.0.0', () => '1.0.0');
  const store = createUpdaterStateStore(config);
  const [job, backup, restore] = await Promise.all([store.readJob(), store.readBackup(), store.readRestore()]);
  const refusal = upgradeRefusal({
    root: process.getuid?.() === 0,
    tag: tagOfHead(),
    packageVersion,
    clean: run('git', ['status', '--porcelain', '--untracked-files=normal'], { quiet: true }) === '',
    jobPhase: job?.phase ?? null,
    backupPhase: backup?.phase ?? null,
    restorePhase: restore?.phase ?? null,
    running,
  });
  if (refusal) throw new Error(refusal);
  await existingShim(TOME_SHIM_PATH);
  console.log(`The updater is ${running}. This checkout's is ${UPDATER_VERSION}.`);
  if (dryRun) {
    console.log(`Would build the updater and tome, replace ${INSTALL_DIRECTORY}, ${SERVICE_FILE} and ${config.composeFile}, install ${TOME_SHIM_PATH}, and restart tomecms-updater.`);
    return;
  }

  const staging = await mkdtemp(join(tmpdir(), 'tomecms-updater-upgrade-'));
  try {
    run('npm', ['run', 'build:updater', '--', '--outDir', join(staging, 'updater')]);
    await writeFile(join(staging, 'updater', 'package.json'), '{"type":"module"}\n', { mode: 0o644 });
    const result = await swapUpdater({
      install: INSTALL_DIRECTORY, service: SERVICE_FILE, compose: config.composeFile, built: staging,
      releaseService: join(repository, 'config/systemd/tomecms-updater.service'), releaseCompose: join(repository, 'compose.managed.yaml'),
      shim: TOME_SHIM_PATH,
    }, new Date().toISOString().replace(/[-:.]/g, ''), {
      run: (command, args) => { run(command, args); },
      jobPhase: async () => (await store.readJob())?.phase ?? null,
      backupPhase: async () => (await store.readBackup())?.phase ?? null,
      restorePhase: async () => (await store.readRestore())?.phase ?? null,
      answers: () => answers(config.socketPath, UPDATER_VERSION),
      log: (line) => console.error(line),
    });
    if (result.composeChanged) {
      console.log(`${config.composeFile} was not the release's own, and has been replaced by it. Your copy is kept at ${result.previousCompose}; move back any change of yours that still matters.`);
    }
    console.log(`The updater is now ${UPDATER_VERSION}. The previous one is kept at ${result.previous}.`);
    console.log(`tome is installed at ${TOME_SHIM_PATH}. Try: sudo tome status`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

// The shim as the 1.11.0 development builds wrote it, before it carried the marker line.
const UNMARKED_TOME_SHIM = `#!/bin/sh\nexec /usr/bin/node ${UPDATER_INSTALL_DIRECTORY}/cli/main.js "$@"\n`;

/**
 * The `tome` already at `path`: null when there is none, and its text when it is TomeCMS's, which
 * says so with the marker line. Anything else there (another program, a link, a binary) is refused
 * and left as it is.
 */
export async function existingShim(path: string): Promise<string | null> {
  const metadata = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!metadata) return null;
  if (metadata.isFile() && metadata.size <= 4096) {
    const text = await readFile(path, 'utf8');
    if (text.split('\n').includes(TOME_SHIM_MARKER) || text === UNMARKED_TOME_SHIM) return text;
  }
  throw new Error(`${path} is not TomeCMS's tome command, so it is left alone. Move it aside, then run this again.`);
}

export interface SwapPaths {
  install: string;
  service: string;
  compose: string;
  /** The staging directory holding the freshly built `updater/`. */
  built: string;
  releaseService: string;
  releaseCompose: string;
  /** Where `tome` goes on the PATH. */
  shim: string;
}

export interface SwapOperations {
  run(command: string, args: string[]): void;
  /** The phase of the updater's job, read again once the updater is stopped. */
  jobPhase(): Promise<string | null>;
  /** The phase of the last backup on request, read at the same moment. */
  backupPhase(): Promise<string | null>;
  /** The phase of the last restore, read at the same moment. */
  restorePhase(): Promise<string | null>;
  /** Whether the started updater answers with the new version. */
  answers(): Promise<boolean>;
  log(line: string): void;
}

/**
 * Stops the updater, puts the new one (with the CLI built beside it), the release's unit and compose
 * file and the `tome` shim in place, and starts it. The old ones are kept with `.previous-<stamp>`
 * (the previous CLI inside the previous updater), and put back if anything fails. The old shim is
 * held in memory rather than left on the PATH under another name.
 */
export async function swapUpdater(paths: SwapPaths, stamp: string, ops: SwapOperations): Promise<{ previous: string; previousCompose: string; composeChanged: boolean }> {
  const previous = `${paths.install}.previous-${stamp}`;
  const previousService = `${paths.service}.previous-${stamp}`;
  const previousCompose = `${paths.compose}.previous-${stamp}`;
  const composeChanged = (await readFile(paths.compose, 'utf8').catch(() => '')) !== await readFile(paths.releaseCompose, 'utf8');
  // Checked before anything stops: a `tome` that is not ours is never overwritten.
  const previousShim = await existingShim(paths.shim);

  ops.run('systemctl', ['stop', 'tomecms-updater']);
  // Checked before a build that takes a while; an update may have started since. A stopped updater
  // starts none, so this is the one moment the answer holds.
  const phase = await ops.jobPhase().catch(() => 'unknown');
  if (phase !== null && !TERMINAL.has(phase)) {
    ops.run('systemctl', ['start', 'tomecms-updater']);
    throw new Error('An update is in progress. Wait for it to finish, then run this again.');
  }
  const backupPhase = await ops.backupPhase().catch(() => 'unknown');
  if (backupPhase !== null && !BACKUP_TERMINAL.has(backupPhase)) {
    ops.run('systemctl', ['start', 'tomecms-updater']);
    throw new Error(backupInProgress);
  }
  const restorePhase = await ops.restorePhase().catch(() => 'unknown');
  if (restorePhase !== null && !BACKUP_TERMINAL.has(restorePhase)) {
    ops.run('systemctl', ['start', 'tomecms-updater']);
    throw new Error(restoreInProgress);
  }

  let moved = false;
  try {
    await rename(paths.install, previous);
    moved = true;
    await cp(join(paths.built, 'updater'), paths.install, { recursive: true });
    ops.run('chown', ['-R', 'root:root', paths.install]);
    ops.run('chmod', ['-R', 'u=rwX,go=rX', paths.install]);
    await cp(paths.service, previousService);
    await cp(paths.releaseService, paths.service);
    // The release's own compose file, which since 1.0.3 runs the app under an init. A change takes
    // effect the next time the app starts; the running site is left alone.
    await cp(paths.compose, previousCompose);
    await cp(paths.releaseCompose, paths.compose);
    await installShim(TOME_SHIM);
    ops.run('systemctl', ['daemon-reload']);
    ops.run('systemctl', ['start', 'tomecms-updater']);
    if (!(await ops.answers())) throw new Error('The new updater did not answer.');
    return { previous, previousCompose, composeChanged };
  } catch (error) {
    if (moved) await restore();
    else attempt(() => ops.run('systemctl', ['start', 'tomecms-updater']), 'start the updater');
    throw error;
  }

  // Every step is tried whatever the one before did, and the updater is started last, so a failure
  // here leaves as much of the old updater in place, and running, as it can.
  async function restore(): Promise<void> {
    ops.log('Putting the previous updater back.');
    attempt(() => ops.run('systemctl', ['stop', 'tomecms-updater']), 'stop the new updater');
    await attemptAsync(async () => {
      await rm(paths.install, { recursive: true, force: true });
      await rename(previous, paths.install);
    }, `put ${previous} back at ${paths.install}`);
    await attemptAsync(() => cp(previousService, paths.service), `put ${previousService} back`);
    await attemptAsync(() => cp(previousCompose, paths.compose), `put ${previousCompose} back`);
    // The shim runs whatever CLI is installed, so it follows the updater back; none, if there was none.
    await attemptAsync(() => previousShim === null ? rm(paths.shim, { force: true }) : installShim(previousShim), `put ${paths.shim} back`);
    attempt(() => ops.run('systemctl', ['daemon-reload']), 'reload systemd');
    attempt(() => ops.run('systemctl', ['start', 'tomecms-updater']), 'start the updater');
  }
  // Written beside it and renamed over it, so the command on the PATH is never half written.
  async function installShim(content: string): Promise<void> {
    const pending = `${paths.shim}.pending-${stamp}`;
    try {
      await writeFile(pending, content, { mode: 0o755 });
      await chmod(pending, 0o755);
      ops.run('chown', ['root:root', pending]);
      await rename(pending, paths.shim);
    } finally {
      await rm(pending, { force: true });
    }
  }
  function attempt(step: () => void, what: string): void {
    try { step(); } catch { ops.log(`Could not ${what}. Do it by hand.`); }
  }
  async function attemptAsync(step: () => Promise<unknown>, what: string): Promise<void> {
    try { await step(); } catch { ops.log(`Could not ${what}. Do it by hand.`); }
  }
}

// Node runs a module by its real path, so a link to the script still counts as starting it.
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
