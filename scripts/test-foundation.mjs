import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const compose = ['compose', '-p', 'tomecms-foundation-test', '-f', 'compose.test.yaml'];
const requested = process.argv.slice(2);
const runAll = requested.includes('--all');
if (runAll && requested.length !== 1) throw new Error('--all cannot be combined with individual test files.');
const testFiles = runAll
  ? (await readdir(fileURLToPath(new URL('../tests/integration/', import.meta.url)), { recursive: true }))
    .filter((path) => path.endsWith('.test.ts')).sort().map((path) => `tests/integration/${path}`)
  : requested.length ? requested : ['tests/integration/foundation.test.ts'];
const requiresStorage = runAll || testFiles.includes('tests/integration/foundation.test.ts');
// Database-only focused checks do not start storage; readiness and the full gate do.
const composeEnv = { ...process.env, MINIO_LICENSE_FILE: requiresStorage ? process.env.MINIO_LICENSE_FILE : '/dev/null' };
const testEnv = {
  ...process.env,
  NODE_ENV: 'test',
  ASTRO_TELEMETRY_DISABLED: '1',
  DATABASE_URL: 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
  DATABASE_POOL_MAX: '1',
  DATABASE_CONNECTION_TIMEOUT_MS: '200',
  DATABASE_QUERY_TIMEOUT_MS: '300',
  TOME_CMS_PUBLIC_URL: 'http://127.0.0.1:4321',
  TOME_CMS_INSTALL_TOKEN: 'foundation-test-install-token-only',
  BETTER_AUTH_SECRET: 'foundation-test-auth-secret-only-32',
  TOME_CMS_CONTEXT_SECRET: 'foundation-test-context-secret-only',
  TOME_CMS_RECOVERY_PEPPER: 'foundation-test-recovery-pepper-only',
  S3_ENDPOINT: 'http://127.0.0.1:59000',
  S3_ACCESS_KEY_ID: 'tomecms_test',
  S3_SECRET_ACCESS_KEY: 'foundation-test-only',
  S3_BUCKET: 'tomecms-test-media',
  S3_REGION: 'us-east-1',
  S3_FORCE_PATH_STYLE: 'true',
  MEDIA_PUBLIC_URL: 'http://127.0.0.1:59000/tomecms-test-media/',
  TOME_CMS_FRONTEND_MODE: 'bundled',
};
const controller = new AbortController();
const interrupt = () => controller.abort();
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);

function run(command, args, env, timeout, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit', timeout, signal });
    let failure;
    child.once('error', error => { failure = error; });
    child.once('close', code => {
      if (failure || code !== 0) reject(new Error(`${command} ${args[0]} failed.`));
      else resolve();
    });
  });
}

try {
  if (requiresStorage && !process.env.MINIO_LICENSE_FILE) throw new Error('MINIO_LICENSE_FILE is required for storage integration checks.');
  const services = requiresStorage ? ['postgres', 'minio'] : ['postgres'];
  await run('docker', [...compose, 'up', '-d', '--wait', '--wait-timeout', '90', ...services], composeEnv, 180_000, controller.signal);
  if (requiresStorage) await run('docker', [...compose, 'run', '--rm', '--no-deps', 'minio-init'], composeEnv, 120_000, controller.signal);
  await run(process.execPath, [
    '--import', 'tsx', '--test', '--test-concurrency=1', ...testFiles,
  ], testEnv, 600_000, controller.signal);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  try {
    await run('docker', [...compose, 'down', '--volumes', '--remove-orphans'], composeEnv, 60_000);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', interrupt);
}
