import { chmod, readFile } from 'node:fs/promises';

import { parseUpdaterConfig } from './config.js';
import { createUpdaterServer, removeStaleUpdaterSocket } from './server.js';
import { reconcileRestore, runRestore } from './restore.js';
import { createUpdaterStateStore } from './state.js';
import { applyUpdate, reconcileBackup, reconcileUpdate, runBackup, runPrune } from './transaction.js';
import { assertBackupSpace } from './verify.js';
import { UPDATER_VERSION } from './version.js';

const configPath = process.argv[2] ?? '/etc/tome-cms/updater.json';
const config = parseUpdaterConfig(JSON.parse(await readFile(configPath, 'utf8')));
const state = createUpdaterStateStore(config);
await removeStaleUpdaterSocket(config.socketPath);
await reconcileUpdate({ config, state });
await reconcileBackup({ config, state });
await reconcileRestore({ config, state });
const server = createUpdaterServer({
  state,
  apply: ({ version, requestId }) => state.createJob({ targetVersion: version, requestId }),
  execute: ({ version, requestId }) => applyUpdate({ version, requestId, updaterVersion: UPDATER_VERSION, config, state }),
  backup: { check: () => assertBackupSpace(config), run: (backup) => runBackup({ backup, config, state }) },
  prune: ({ dryRun }) => runPrune({ dryRun, config, state }),
  restore: { check: () => assertBackupSpace(config), run: (restore) => runRestore({ restore, config, state }) },
});

server.listen(config.socketPath, async () => {
  try {
    await chmod(config.socketPath, 0o660);
  } catch (error) {
    server.close();
    throw error;
  }
});
