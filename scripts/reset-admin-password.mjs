#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

const RELOADED_ENV = 'TOMECMS_PASSWORD_RESET_ENV_LOADED';

function adminKey(environment = process.env) {
  return environment.SUPABASE_SECRET_KEY || environment.SUPABASE_SERVICE_ROLE_KEY;
}

function passwordError(password, confirmation) {
  if (password.length < 12 || password.length > 128) {
    return 'Password must contain between 12 and 128 characters.';
  }
  if (password !== confirmation) return 'Passwords do not match.';
  return null;
}

function selfTest() {
  assert.equal(adminKey({ SUPABASE_SECRET_KEY: 'current', SUPABASE_SERVICE_ROLE_KEY: 'legacy' }), 'current');
  assert.equal(adminKey({ SUPABASE_SERVICE_ROLE_KEY: 'legacy' }), 'legacy');
  assert.match(passwordError('x'.repeat(11), 'x'.repeat(11)), /12 and 128/);
  assert.equal(passwordError('x'.repeat(12), 'x'.repeat(12)), null);
  assert.equal(passwordError('x'.repeat(128), 'x'.repeat(128)), null);
  assert.match(passwordError('x'.repeat(129), 'x'.repeat(129)), /12 and 128/);
  assert.match(passwordError('x'.repeat(12), 'y'.repeat(12)), /do not match/);
  console.log('Admin password reset self-check passed.');
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

function ensureEnvironment() {
  const missingUrl = !process.env.PUBLIC_SUPABASE_URL;
  const missingKey = !adminKey();
  if (!missingUrl && !missingKey) return;

  if (missingUrl && missingKey && !process.env[RELOADED_ENV]) {
    const envFile = readableEnvFile();
    if (envFile) {
      const result = spawnSync(
        process.execPath,
        [`--env-file=${envFile}`, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
        {
          env: { ...process.env, [RELOADED_ENV]: '1' },
          stdio: 'inherit',
        },
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

async function ask(question) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await prompt.question(question);
  } finally {
    prompt.close();
  }
}

async function askSecret(question) {
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk, encoding);
      callback();
    },
  });
  const prompt = createInterface({ input: process.stdin, output, terminal: true });

  try {
    const answer = prompt.question(question);
    muted = true;
    return await answer;
  } finally {
    prompt.close();
    process.stdout.write('\n');
  }
}

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Run this command in an interactive terminal so the password can stay hidden.');
  }

  ensureEnvironment();
  const url = process.env.PUBLIC_SUPABASE_URL;
  const serviceRoleKey = adminKey();
  const projectUrl = new URL(url);
  if (!['http:', 'https:'].includes(projectUrl.protocol)) {
    throw new Error('PUBLIC_SUPABASE_URL must use http or https.');
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: settings, error: settingsError } = await supabase
    .from('site_settings')
    .select('owner_id')
    .eq('id', true)
    .maybeSingle();
  if (settingsError) throw new Error(`Could not read site settings: ${settingsError.message}`);
  if (!settings?.owner_id) throw new Error('TomeCMS is not installed or has no owner account.');

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.admin.getUserById(settings.owner_id);
  if (userError) throw new Error(`Could not read the owner account: ${userError.message}`);
  if (!user?.email) throw new Error('The configured owner account has no email address.');

  console.log(`Supabase: ${projectUrl.origin}`);
  console.log(`Owner: ${user.email}`);
  const confirmation = await ask('Type RESET to continue: ');
  if (confirmation !== 'RESET') {
    console.log('Cancelled. No changes were made.');
    return;
  }

  let password = await askSecret('New password: ');
  let repeatedPassword = await askSecret('Repeat new password: ');
  const validationError = passwordError(password, repeatedPassword);
  if (validationError) throw new Error(validationError);

  const { error: updateError } = await supabase.auth.admin.updateUserById(settings.owner_id, { password });
  password = '';
  repeatedPassword = '';
  if (updateError) throw new Error(`Could not update the owner password: ${updateError.message}`);

  console.log(`Password updated for ${user.email}. Sign in again with the new password.`);
  console.log('Previously issued access tokens can remain valid until they expire.');
}

if (process.argv[2] === '--self-test') {
  selfTest();
} else {
  main().catch((error) => {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
