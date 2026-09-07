import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const RELOADED_ENV = 'TOMECMS_SUPABASE_ENV_LOADED';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);

export function adminKey(environment = process.env) {
  return environment.SUPABASE_SECRET_KEY || environment.SUPABASE_SERVICE_ROLE_KEY;
}

export function supabaseOrigin(rawUrl) {
  const url = new URL(rawUrl);
  const basePath = url.pathname === '' || url.pathname === '/';
  if (url.username || url.password || url.search || url.hash || !basePath) {
    throw new Error('Use the Supabase base URL without credentials, a path, query, or fragment.');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))) {
    throw new Error('Use HTTPS. Plain HTTP is accepted only for a loopback Supabase instance.');
  }
  return url.origin;
}

function readableEnvFile() {
  const candidates = process.env.TOMECMS_ENV_FILE
    ? [resolve(process.env.TOMECMS_ENV_FILE)]
    : [resolve('.env.local'), resolve('.env'), '/etc/tome-cms/tome-cms.env'];

  return candidates.find((file) => {
    try {
      accessSync(file, constants.R_OK);
      return true;
    } catch {
      return false;
    }
  });
}

export function ensureSupabaseAdminEnvironment(scriptUrl) {
  const missingUrl = !process.env.PUBLIC_SUPABASE_URL;
  const missingKey = !adminKey();
  if (!missingUrl && !missingKey) return;

  if (missingUrl && missingKey && !process.env[RELOADED_ENV]) {
    const envFile = readableEnvFile();
    if (envFile) {
      const result = spawnSync(
        process.execPath,
        [`--env-file=${envFile}`, fileURLToPath(scriptUrl), ...process.argv.slice(2)],
        { env: { ...process.env, [RELOADED_ENV]: '1' }, stdio: 'inherit' },
      );
      if (result.error) throw result.error;
      process.exit(result.status ?? 1);
    }
  }

  throw new Error(
    'PUBLIC_SUPABASE_URL and a Supabase secret or service-role key must be configured together. ' +
      'Set TOMECMS_ENV_FILE to a readable environment file when using a custom path.',
  );
}
