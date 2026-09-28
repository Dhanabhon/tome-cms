// Sets aside a managed update that failed before its backup, so "System" can start another.
// Such a job changed neither the database nor the running image; anything later needs the
// recovery steps instead, and this refuses it. Run as root from a checkout of the release:
//   sudo npm run updater:clear-failed
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

import { parseUpdaterConfig } from '../src/updater/config.ts';
import { createUpdaterStateStore } from '../src/updater/state.ts';

function systemctl(action: 'stop' | 'start'): void {
  const result = spawnSync('systemctl', [action, 'tomecms-updater'], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`systemctl ${action} tomecms-updater failed.`);
}

if (process.getuid?.() !== 0) {
  console.error('Run this as root, for example with sudo.');
  process.exit(1);
}
const config = parseUpdaterConfig(JSON.parse(await readFile(process.argv[2] ?? '/etc/tome-cms/updater.json', 'utf8')));
// Stopped while the job moves, then started so that the service, not root, rewrites status.json.
systemctl('stop');
try {
  const job = await createUpdaterStateStore(config).clearUnstartedFailure();
  console.log(`Cleared the failed update to ${job.targetVersion}. Its record is kept as job.json.cleared-${job.id}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  systemctl('start');
}
