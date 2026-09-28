// Lists the migrations inside a local image exactly as the installer and the updater do, and
// fails unless the list ends at this checkout's newest migration. 1.0.0 shipped with that step
// broken on every server, because no test had run it against a real image.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

import { migrationInventoryArgs } from '../src/updater/inventory.ts';

const image = process.argv[2];
if (!image) {
  console.error('Usage: npm run check:inventory -- <image>');
  process.exit(2);
}
const expected = readdirSync('src/server/db/migrations')
  .filter(name => /^\d{3}_[a-z0-9_]+\.ts$/.test(name)).sort().at(-1)?.replace(/\.ts$/, '');
const result = spawnSync('docker', ['run', '--rm', ...migrationInventoryArgs(image)], { encoding: 'utf8', timeout: 120_000 });
if (result.status !== 0) {
  console.error(result.stderr || result.error?.message || 'docker run failed.');
  process.exit(1);
}
const inventory: unknown = JSON.parse(result.stdout);
if (!Array.isArray(inventory) || inventory.at(-1) !== expected) {
  console.error(`The image's migrations end at ${String(Array.isArray(inventory) ? inventory.at(-1) : inventory)}, not ${expected}.`);
  process.exit(1);
}
console.log(`${inventory.length} migrations, ending at ${expected}.`);
