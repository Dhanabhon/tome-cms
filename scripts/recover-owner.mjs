import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const candidates = process.env.TOME_CMS_ENV_FILE
  ? [resolve(process.env.TOME_CMS_ENV_FILE)]
  : [resolve(projectRoot, '.env.local'), '/etc/tome-cms/tome-cms.env'];
const envFile = candidates.find((candidate) => {
  try {
    accessSync(candidate, constants.R_OK);
    return true;
  } catch {
    return false;
  }
});

if (!envFile && !process.argv.includes('--self-test')) {
  console.error('No readable TomeCMS environment file found. Set TOME_CMS_ENV_FILE or create .env.local.');
  process.exitCode = 1;
} else {
  const result = spawnSync(process.execPath, [
    ...(envFile ? [`--env-file=${envFile}`] : []),
    '--import', 'tsx', resolve(projectRoot, 'scripts/recover-owner.ts'), ...process.argv.slice(2),
  ], { cwd: projectRoot, stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
}
