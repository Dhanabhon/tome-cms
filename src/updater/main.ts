import { chmod, readFile } from 'node:fs/promises';

import { parseUpdaterConfig } from './config.js';
import { createUpdaterServer, removeStaleUpdaterSocket } from './server.js';
import { createUpdaterStateStore } from './state.js';
import { applyUpdate, reconcileUpdate } from './transaction.js';

const configPath = process.argv[2] ?? '/etc/tome-cms/updater.json';
const config = parseUpdaterConfig(JSON.parse(await readFile(configPath, 'utf8')));
const state = createUpdaterStateStore(config);
await removeStaleUpdaterSocket(config.socketPath);
await reconcileUpdate({ config, state });
const server = createUpdaterServer({
  state,
  apply: ({ version, requestId }) => state.createJob({ targetVersion: version, requestId }),
  execute: ({ version, requestId }) => applyUpdate({ version, requestId, updaterVersion: '1.0.0', config, state }),
});

server.listen(config.socketPath, async () => {
  try {
    await chmod(config.socketPath, 0o660);
  } catch (error) {
    server.close();
    throw error;
  }
});
