// Sets aside a managed job that left the updater refusing every other one, so "System" or `tome`
// can start the next:
// - an update that failed before its backup. Such a job changed neither the database nor the
//   running image; anything later needs the recovery steps instead, and this refuses it;
// - a failed restore that kept the site in maintenance with the app stopped: its safety backup
//   could not be put back (`rollback_failed`), or it found the app stopped and left it so. This
//   takes the site out of maintenance and touches nothing else; the next step is to restore the
//   safety backup, or the backup again.
// Run as root from a checkout of the release:
//   sudo npm run updater:clear-failed
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { printable } from '../src/cli/output.ts';
import { parseUpdaterConfig } from '../src/updater/config.ts';
import { createUpdaterStateStore, type UpdaterStateStore } from '../src/updater/state.ts';

/** Clears the one job that holds the others up, and says what it did and what comes next. */
export async function clearFailedJob(store: UpdaterStateStore): Promise<string> {
  const restore = await store.readRestore();
  // A restore that ended any other way holds nothing up, so the update's record is the one meant.
  const restoreHolds = restore !== null && restore.phase !== 'succeeded' && !(restore.phase === 'failed' && !restore.maintenanceKept);
  if (restoreHolds) {
    const { restore: cleared, keptAs } = await store.clearFailedRestore();
    const backup = printable(cleared.backupDirectory);
    const safety = cleared.safetyBackupDirectory === null ? null : printable(cleared.safetyBackupDirectory);
    // After rollback_failed the database is in a state no one knows: the backup that failed is no way out.
    const [what, next] = cleared.errorCode !== 'rollback_failed'
      ? ['which failed on a site it found stopped', `Next: sudo tome restore ${backup}, to run the restore again.`]
      : safety
        ? ['whose safety backup could not be put back', `Next: sudo tome restore ${safety}, to put the safety backup back, or the restore again.`]
        : ['which failed with no safety backup to put back',
          'Next: restore the newest backup, which starts the app (sudo tome status shows it): sudo tome restore <newest backup>'];
    return [
      `Set aside the restore of ${backup}, ${what}. Its record is kept as ${keptAs}.`,
      'The site is out of maintenance. Nothing else was changed: the app is still stopped.',
      next,
    ].join('\n');
  }
  // Run again after a restore was set aside, it has nothing to do, and says so of both.
  if (await store.readJob() === null) {
    throw new Error('There is nothing to clear: no restore keeps the site in maintenance, and no update failed before its backup.');
  }
  const job = await store.clearUnstartedFailure();
  return `Cleared the failed update to ${job.targetVersion}. Its record is kept as job.json.cleared-${job.id}.`;
}

function systemctl(action: 'stop' | 'start'): void {
  const result = spawnSync('systemctl', [action, 'tomecms-updater'], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`systemctl ${action} tomecms-updater failed.`);
}

async function main(): Promise<void> {
  if (process.getuid?.() !== 0) {
    console.error('Run this as root, for example with sudo.');
    process.exitCode = 1;
    return;
  }
  const config = parseUpdaterConfig(JSON.parse(await readFile(process.argv[2] ?? '/etc/tome-cms/updater.json', 'utf8')));
  // Stopped while the record moves, then started so that the service, not root, rewrites status.json.
  systemctl('stop');
  try {
    console.log(await clearFailedJob(createUpdaterStateStore(config)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    systemctl('start');
  }
}

// Node runs a module by its real path, so a link to the script still counts as starting it.
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) await main();
