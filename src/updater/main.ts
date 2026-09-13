import { chmod, readFile } from 'node:fs/promises';

import { parseUpdaterConfig } from './config.js';
import { createUpdaterServer } from './server.js';
import { createUpdaterStateStore } from './state.js';

const configPath = process.argv[2] ?? '/etc/tome-cms/updater.json';
const config = parseUpdaterConfig(JSON.parse(await readFile(configPath, 'utf8')));
const state = createUpdaterStateStore(config);
const server = createUpdaterServer({
  state,
  apply: ({ version, requestId }) => state.createJob({ targetVersion: version, requestId }),
});

server.listen(config.socketPath, async () => {
  try {
    await chmod(config.socketPath, 0o660);
  } catch (error) {
    server.close();
    throw error;
  }
});
