#!/usr/bin/env node

import assert from 'node:assert/strict';
import { DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { sql } from 'kysely';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';

import { isTomeObjectKey } from '../src/server/media/keys.ts';

export function parseResetOptions(args) {
  if (!args.length || (args.length === 1 && args[0] === '--dry-run')) return { execute: false };
  if (args.length === 1 && args[0] === '--execute') return { execute: true };
  throw new Error('Usage: npm run admin:reset-installation [-- --dry-run|--execute]');
}

export function databaseName(databaseUrl) {
  const name = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (!name) throw new Error('DATABASE_URL must include a database name.');
  return name;
}

export function resetConfirmation(origin, database, bucket) {
  return `RESET ${origin} ${database} ${bucket}`;
}

function isStorageNotFound(error) {
  return error && typeof error === 'object' && (
    error.name === 'NoSuchKey' || error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404
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

async function inventory(database) {
  const result = await sql`
    select
      (select count(*)::integer from "user") as users,
      (select count(*)::integer from session) as sessions,
      (select count(*)::integer from passkey) as passkeys,
      (select count(*)::integer from recovery_codes) as recovery_codes,
      (select count(*)::integer from installation_enrollments) as enrollments,
      (select count(*)::integer from posts) as posts,
      (select count(*)::integer from pages) as pages,
      (select count(*)::integer from categories) as categories,
      (select count(*)::integer from navigation_items) as navigation_items,
      (select count(*)::integer from media_folders) as media_folders,
      (select count(*)::integer from media_items where state = 'ready') as media_ready,
      (select count(*)::integer from media_items where state = 'deleting') as media_deleting,
      (select count(*)::integer from media_items where state = 'delete_failed') as media_delete_failed,
      (select count(*)::integer from media_upload_reservations where state = 'pending') as reservations_pending,
      (select count(*)::integer from media_upload_reservations where state = 'expired') as reservations_expired,
      (select count(*)::integer from media_upload_reservations where expires_at > current_timestamp) as active_upload_signatures
  `.execute(database);
  return result.rows[0];
}

async function knownObjects(database) {
  const media = await database.selectFrom('media_items').select(['id', 'object_key']).execute();
  const reservations = await database.selectFrom('media_upload_reservations').select(['id', 'object_key']).execute();
  const objects = new Map();
  for (const row of [...media, ...reservations]) {
    const ids = objects.get(row.object_key) ?? [];
    ids.push(row.id);
    objects.set(row.object_key, ids);
  }
  return [...objects].map(([key, ids]) => ({ ids, key })).sort((left, right) => left.key.localeCompare(right.key));
}

function sameObjectKeys(left, right) {
  return left.length === right.length && left.every((item, index) => item.key === right[index]?.key);
}

async function deleteAndVerifyObjects(storage, bucket, objects) {
  for (const [index, object] of objects.entries()) {
    if (!isTomeObjectKey(object.key)) throw new Error(`Media object ${index + 1} has an unsafe key; database data was preserved.`);
    try {
      await storage.send(new DeleteObjectCommand({ Bucket: bucket, Key: object.key }));
      await storage.send(new HeadObjectCommand({ Bucket: bucket, Key: object.key }));
      throw new Error('Object remained after deletion.');
    } catch (error) {
      if (!isStorageNotFound(error)) throw new Error(`Could not remove media object ${index + 1}; database data was preserved.`);
    }
  }
}

async function resetDatabase(database, expectedObjects, verifyObjectsAbsent) {
  await database.transaction().execute(async (transaction) => {
    await sql`
      lock table
        "user", session, account, verification, passkey, installation_enrollments,
        recovery_codes, security_rate_limits, site_settings, post_translation_groups,
        page_translation_groups, categories, posts, pages, post_category_assignments,
        navigation_items, media_folders, media_items, media_upload_reservations
      in access exclusive mode
    `.execute(transaction);
    const currentObjects = await knownObjects(transaction);
    if (!sameObjectKeys(expectedObjects, currentObjects)) {
      throw new Error('TomeCMS data changed during reset; database data was preserved. Stop the app and run reset again.');
    }
    await verifyObjectsAbsent();
    await sql`
      truncate table
        session, account, verification, passkey, installation_enrollments,
        recovery_codes, security_rate_limits, site_settings, post_category_assignments,
        navigation_items, posts, pages, categories, post_translation_groups,
        page_translation_groups, media_upload_reservations, media_items, media_folders, "user"
    `.execute(transaction);
  });
}

function selfTest() {
  assert.deepEqual(parseResetOptions([]), { execute: false });
  assert.deepEqual(parseResetOptions(['--dry-run']), { execute: false });
  assert.deepEqual(parseResetOptions(['--execute']), { execute: true });
  assert.throws(() => parseResetOptions(['--yes']), /Usage/);
  assert.equal(databaseName('postgresql://user:secret@127.0.0.1:5432/tomecms'), 'tomecms');
  assert.equal(
    resetConfirmation('https://cms.example.com', 'tomecms', 'tomecms-media'),
    'RESET https://cms.example.com tomecms tomecms-media',
  );
  assert.equal(isTomeObjectKey('owners/123e4567-e89b-42d3-a456-426614174000/2026/09/123e4567-e89b-42d3-a456-426614174001.webp'), true);
  assert.equal(isTomeObjectKey('../other-bucket/private'), false);
  console.log('Installation reset self-check passed.');
}

async function main() {
  const options = parseResetOptions(process.argv.slice(2));
  const [{ db, closeDatabase }, { getServerEnv }, { s3, s3Bucket }] = await Promise.all([
    import('../src/server/db/client.ts'),
    import('../src/server/env.ts'),
    import('../src/server/media/storage.ts'),
  ]);
  try {
    const env = getServerEnv();
    const origin = new URL(env.TOME_CMS_PUBLIC_URL).origin;
    const database = databaseName(env.DATABASE_URL);
    const [counts, objects, settings] = await Promise.all([
      inventory(db),
      knownObjects(db),
      db.selectFrom('site_settings').select(['site_name', 'owner_id']).where('id', '=', true).executeTakeFirst(),
    ]);
    console.log('TomeCMS reset preview');
    console.log(`Site origin: ${origin}`);
    console.log(`Database: ${database}`);
    console.log(`Bucket: ${s3Bucket}`);
    if (settings) console.log(`Site: ${settings.site_name}`);
    for (const [label, value] of Object.entries(counts)) console.log(`${label}: ${value}`);
    console.log(`Known objects: ${objects.length}`);
    if (!options.execute) {
      console.log('Dry run complete. No changes were made.');
      return;
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run this command in an interactive terminal.');
    if (Number(counts.active_upload_signatures) > 0) {
      throw new Error('Recent signed uploads are still valid. Stop TomeCMS, wait five minutes, and run reset again.');
    }
    const expected = resetConfirmation(origin, database, s3Bucket);
    console.log('This permanently deletes TomeCMS content, media, sessions, recovery data, and owner accounts.');
    if (await ask(`Type "${expected}" to continue: `) !== expected) {
      console.log('Cancelled. No changes were made.');
      return;
    }
    await deleteAndVerifyObjects(s3, s3Bucket, objects);
    await resetDatabase(db, objects, () => deleteAndVerifyObjects(s3, s3Bucket, objects));
    const [remainingSettings, remainingObjects] = await Promise.all([
      db.selectFrom('site_settings').select('id').executeTakeFirst(),
      knownObjects(db),
    ]);
    if (remainingSettings || remainingObjects.length) throw new Error('Reset verification failed.');
    console.log('Reset complete. Restart TomeCMS and open /install.');
    console.log('Use the existing TOME_CMS_INSTALL_TOKEN from .env.local.');
  } finally {
    s3.destroy();
    await closeDatabase();
  }
}

if (process.argv[2] === '--self-test') {
  selfTest();
} else if (process.argv[2] === '--help') {
  console.log('Usage: npm run admin:reset-installation [-- --dry-run|--execute]');
} else if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`Error: ${error instanceof Error ? error.message : 'Installation reset failed.'}`);
    process.exitCode = 1;
  });
}
