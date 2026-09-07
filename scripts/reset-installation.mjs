#!/usr/bin/env node

import assert from 'node:assert/strict';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';

import { createClient } from '@supabase/supabase-js';

import {
  adminKey,
  ensureSupabaseAdminEnvironment,
  supabaseOrigin,
} from './lib/supabase-environment.mjs';

const BUCKET = 'blog-media';
const PAGE_SIZE = 1_000;
const RESET_TABLES = ['posts', 'media_items', 'media_folders'];

function confirmationPhrase(origin) {
  return `RESET ${origin}`;
}

function parseOptions(args) {
  if (args.length === 0) return { dryRun: true };
  if (args.length === 1 && args[0] === '--dry-run') return { dryRun: true };
  if (args.length === 1 && args[0] === '--execute') return { dryRun: false };
  throw new Error('Usage: npm run admin:reset-installation [-- --dry-run|--execute]');
}

function selfTest() {
  assert.equal(adminKey({ SUPABASE_SECRET_KEY: 'current', SUPABASE_SERVICE_ROLE_KEY: 'legacy' }), 'current');
  assert.equal(adminKey({ SUPABASE_SERVICE_ROLE_KEY: 'legacy' }), 'legacy');
  assert.equal(confirmationPhrase('https://example.supabase.co'), 'RESET https://example.supabase.co');
  assert.equal(confirmationPhrase('http://127.0.0.1:54321'), 'RESET http://127.0.0.1:54321');
  assert.equal(supabaseOrigin('http://127.0.0.1:54321/'), 'http://127.0.0.1:54321');
  assert.throws(() => supabaseOrigin('http://supabase.example.com'), /Use HTTPS/);
  assert.equal(pathWithin('owner-id', 'image.png'), 'owner-id/image.png');
  assert.deepEqual(parseOptions([]), { dryRun: true });
  assert.deepEqual(parseOptions(['--dry-run']), { dryRun: true });
  assert.deepEqual(parseOptions(['--execute']), { dryRun: false });
  assert.throws(() => parseOptions(['--yes']), /Usage/);
  console.log('Installation reset self-check passed.');
}

async function ask(question) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await prompt.question(question);
  } finally {
    prompt.close();
  }
}

function pathWithin(prefix, name) {
  return prefix ? `${prefix}/${name}` : name;
}

async function listStoragePaths(bucket) {
  const folders = [''];
  const paths = [];

  for (let folderIndex = 0; folderIndex < folders.length; folderIndex += 1) {
    const prefix = folders[folderIndex];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await bucket.list(prefix, {
        limit: PAGE_SIZE,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw new Error(`Could not list ${BUCKET} Storage: ${error.message}`);

      for (const entry of data) {
        const path = pathWithin(prefix, entry.name);
        if (entry.id) paths.push(path);
        else folders.push(path);
      }
      if (data.length < PAGE_SIZE) break;
    }
  }

  return paths;
}

async function rowCount(supabase, table) {
  const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true });
  if (error) throw new Error(`Could not count ${table}: ${error.message}`);
  return count ?? 0;
}

async function deleteRows(supabase, table) {
  const { error } = await supabase.from(table).delete().not('id', 'is', null);
  if (error) throw new Error(`Could not delete ${table}: ${error.message}`);
}

async function deleteStorage(bucket, paths) {
  for (let index = 0; index < paths.length; index += PAGE_SIZE) {
    const { error } = await bucket.remove(paths.slice(index, index + PAGE_SIZE));
    if (error) throw new Error(`Could not delete ${BUCKET} Storage: ${error.message}`);
  }
}

async function restoreSettings(supabase, settings, cause) {
  const { error } = await supabase.from('site_settings').insert(settings);
  if (error) {
    throw new Error(`${cause} The installer marker could not be restored: ${error.message}`);
  }
  throw new Error(`${cause} The installer marker was restored; fix the error and run the reset again.`);
}

async function main() {
  const { dryRun } = parseOptions(process.argv.slice(2));
  ensureSupabaseAdminEnvironment(import.meta.url);

  const projectOrigin = supabaseOrigin(process.env.PUBLIC_SUPABASE_URL);

  const supabase = createClient(projectOrigin, adminKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: settings, error: settingsError } = await supabase
    .from('site_settings')
    .select('owner_id, site_name')
    .eq('id', true)
    .maybeSingle();
  if (settingsError) throw new Error(`Could not read site settings: ${settingsError.message}`);
  if (!settings) {
    console.log('TomeCMS is already waiting for the Wizard Installer. No changes were made.');
    return;
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.admin.getUserById(settings.owner_id);
  if (userError) throw new Error(`Could not read the owner account: ${userError.message}`);
  if (!user?.email) throw new Error('The configured owner account has no email address.');

  const bucket = supabase.storage.from(BUCKET);
  const [tableCounts, storagePaths] = await Promise.all([
    Promise.all(RESET_TABLES.map((table) => rowCount(supabase, table))),
    listStoragePaths(bucket),
  ]);

  console.log('TomeCMS reset preview');
  console.log(`Supabase: ${projectOrigin}`);
  console.log(`Site: ${settings.site_name}`);
  console.log(`Owner: ${user.email}`);
  console.log(`Posts: ${tableCounts[0]}`);
  console.log(`Media records: ${tableCounts[1]}`);
  console.log(`Media folders: ${tableCounts[2]}`);
  console.log(`Stored files: ${storagePaths.length}`);

  if (dryRun) {
    console.log('Dry run complete. No changes were made.');
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Run this command in an interactive terminal so the destructive reset can be confirmed.');
  }

  console.log('This permanently deletes the items above and the configured owner account.');
  console.log('Close Admin tabs and stop TomeCMS before continuing.');
  const expected = confirmationPhrase(projectOrigin);
  const confirmation = await ask(`Type "${expected}" to continue: `);
  if (confirmation !== expected) {
    console.log('Cancelled. No changes were made.');
    return;
  }

  await deleteStorage(bucket, storagePaths);
  if ((await listStoragePaths(bucket)).length) {
    throw new Error(`${BUCKET} changed during reset. Stop active clients and run the reset again.`);
  }

  for (const table of RESET_TABLES) await deleteRows(supabase, table);

  const { data: settingsBackup, error: backupError } = await supabase
    .from('site_settings')
    .select('*')
    .eq('id', true)
    .single();
  if (backupError) throw new Error(`Could not prepare the installer marker: ${backupError.message}`);

  const { data: deletedSettings, error: deleteSettingsError } = await supabase
    .from('site_settings')
    .delete()
    .eq('id', true)
    .select('id')
    .maybeSingle();
  if (deleteSettingsError) throw new Error(`Could not delete site_settings: ${deleteSettingsError.message}`);
  if (!deletedSettings) throw new Error('The installer marker disappeared during reset.');

  const remaining = await Promise.all(
    [...RESET_TABLES, 'site_settings'].map((table) => rowCount(supabase, table)),
  );
  if (remaining.some(Boolean)) {
    await restoreSettings(supabase, settingsBackup, 'TomeCMS data changed during reset.');
  }

  const { error: deleteUserError } = await supabase.auth.admin.deleteUser(settings.owner_id);
  if (deleteUserError) {
    await restoreSettings(supabase, settingsBackup, `Could not delete the owner account: ${deleteUserError.message}.`);
  }

  console.log('Reset complete. Restart TomeCMS and open /install.');
  console.log('Use the existing TOME_CMS_INSTALL_TOKEN from the environment file.');
  console.log('Previously issued access tokens can remain valid until they expire.');
}

if (process.argv[2] === '--self-test') {
  selfTest();
} else if (process.argv[2] === '--help') {
  console.log('Usage: npm run admin:reset-installation [-- --dry-run|--execute]');
} else {
  main().catch((error) => {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
