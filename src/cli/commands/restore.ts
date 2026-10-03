import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

import { parseBackupManifest, type BackupManifest, type BackupRecordCounts } from '../../update/backup.js';
import { compareStableVersions } from '../../update/contracts.js';
import { readManifestBytes } from '../../updater/files.js';
import type { RestoreJob } from '../../updater/state.js';
import type { CliContext } from '../main.js';
import { explainError, localTime, manualRecovery, printable, restoreStep } from '../output.js';
import { assertUnderBackupRoot, chownTree, findUnsafeEntry, ownerOfBackupRoot } from '../ownership.js';
import { errorCodeOf, follow, isRestoreRunning, isRestoreStuck, postJob, readRestore, readStatus, refusal, stuckRestoreAdvice } from '../socket.js';

// The first app whose image carries the restore steps, and the first updater with the restore job.
const RESTORE_APP_SINCE = '1.13.0';
const RESTORE_UPDATER_SINCE = '1.6.0';
// tome's own refusal of a manifest: the updater was never asked, so its log has nothing to show.
const manifestUnreadable = 'That backup did not pass its checks: its manifest.json does not read as a TomeCMS backup\'s. Nothing was changed.';

/**
 * Puts a backup back into the site through the updater's `/v1/restore`. Everything the updater checks
 * is checked here first, so a refusal comes before the question; the updater checks it all again,
 * with every checksum, before it stops anything.
 */
export async function restore(context: CliContext, options: { directory: string; yes: boolean }): Promise<number> {
  const { config } = context;
  let directory: string;
  try {
    directory = await assertUnderBackupRoot(config.backupDirectory, options.directory);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    context.warn(code && !['ENOENT', 'ENOTDIR', 'ELOOP'].includes(code)
      ? `That backup directory could not be read (${printable(code)}), so nothing was changed.`
      : 'That is not a backup directory under /var/backups/tome-cms.');
    return 1;
  }
  let manifest: BackupManifest;
  try {
    manifest = parseBackupManifest(JSON.parse((await readManifestBytes(directory)).toString('utf8')));
  } catch (error) {
    context.warn((error as NodeJS.ErrnoException).code === 'ENOENT'
      ? 'That backup has no manifest.json, so it was cut off or is not a TomeCMS backup.'
      : manifestUnreadable);
    return 1;
  }
  const unsafe = await findUnsafeEntry(directory);
  if (unsafe !== null) {
    context.warn(`That backup holds a link or a special file (${printable(unsafe)}), so nothing was changed.`);
    return 1;
  }
  const refused = await refuse(context, manifest);
  if (refused) {
    context.warn(refused);
    return 1;
  }

  summarize(context, directory, manifest);
  if (!options.yes && !await context.confirm('Restore this backup? [y/N] ')) {
    context.print('Nothing was done.');
    return 1;
  }
  try {
    await chownTree(context.runCommand, directory, await ownerOfBackupRoot(config.backupDirectory));
  } catch (error) {
    context.warn(`The backup could not be handed to the updater (${error instanceof Error ? error.message : String(error)}), so nothing was changed.`);
    return 1;
  }

  const id = context.requestId();
  const answer = await postJob(context.socket, context.sleep, '/v1/restore', { requestId: id, backupDirectory: directory });
  if (answer.status !== 202 && answer.status !== 200) {
    const code = errorCodeOf(answer);
    context.warn(code === 'insufficient_disk_space'
      ? explainError(code, 'restore', config)
      : await refusal(context.socket, answer) ?? `The updater refused the restore (${printable(code ?? String(answer.status))}).`);
    return 1;
  }
  const ended = await follow(context, async () => {
    const record = await readRestore(context.socket);
    if (record?.id !== id) throw new Error('The updater is following another restore');
    return record;
  }, (record) => restoreStep(record.phase), async (record) => !isRestoreRunning(record) || await isRestoreStuck(context.socket, record));
  return report(context, ended);
}

/** Why the updater would refuse this backup on this site, or null when it would take it. */
async function refuse(context: CliContext, manifest: BackupManifest): Promise<string | null> {
  const status = await readStatus(context.socket);
  const updater = printable(status.updaterVersion);
  const installed = printable(status.installed.version);
  if (compareStableVersions(status.updaterVersion, RESTORE_UPDATER_SINCE) < 0) {
    return `The updater is ${updater}. Restore needs updater ${RESTORE_UPDATER_SINCE}: run sudo npm run updater:upgrade from a v${RESTORE_APP_SINCE} checkout.`;
  }
  if (compareStableVersions(status.installed.version, RESTORE_APP_SINCE) < 0) {
    return `This site runs TomeCMS ${installed}. Restore needs ${RESTORE_APP_SINCE} or newer: sudo tome update`;
  }
  // The domain never changes in a restore, so passkeys keep working.
  const theirs = new URL(manifest.config.publicUrl).origin;
  const ours = await siteOrigin(context.config.environmentFile);
  if (theirs !== ours) {
    return `That backup is from ${printable(theirs)}, and this site is ${printable(ours)}. A restore keeps the site's address.`;
  }
  let newer: boolean;
  try {
    newer = compareStableVersions(manifest.applicationVersion, status.installed.version) > 0;
  } catch {
    return manifestUnreadable;
  }
  const version = printable(manifest.applicationVersion);
  return newer ? `That backup is from TomeCMS ${version}, newer than this site's ${installed}. Update the site to ${version} first: sudo tome update ${version}` : null;
}

async function siteOrigin(environmentFile: string): Promise<string> {
  const url = parseEnv(await readFile(environmentFile, 'utf8')).TOME_CMS_PUBLIC_URL;
  try {
    return new URL(url ?? '').origin;
  } catch {
    throw new Error(`TOME_CMS_PUBLIC_URL in ${environmentFile} is not a URL`);
  }
}

function summarize(context: CliContext, directory: string, manifest: BackupManifest): void {
  const databaseOnly = manifest.scope === 'database';
  context.print(`Backup: ${printable(directory)}`);
  context.print(`Made ${localTime(manifest.createdAt)} by TomeCMS ${printable(manifest.applicationVersion)}, for ${printable(new URL(manifest.config.publicUrl).origin)}.`);
  context.print(`It holds the ${databaseOnly ? 'database only' : 'database and media'}: ${counts(manifest.records)}.`);
  context.print(databaseOnly
    ? 'Everything in this site\'s database will be replaced by the backup; its media stay as they are.'
    : 'Everything on this site will be replaced by the backup.');
}

function report(context: CliContext, record: RestoreJob): number {
  if (isRestoreRunning(record)) {
    context.warn(stuckRestoreAdvice(record.phase));
    return 1;
  }
  if (record.phase !== 'succeeded') {
    context.warn(explainError(record.errorCode, 'restore', context.config));
    if (record.maintenanceKept) for (const line of manualRecovery(record)) context.warn(line);
    return 1;
  }
  if (record.report) context.print(`Restored: ${counts(record.report.records)}.`);
  if (record.migrated) context.print('Migrations ran.');
  if (record.safetyBackupDirectory) context.print(`The site as it was before the restore is kept in ${printable(record.safetyBackupDirectory)}.`);
  const secrets = record.report;
  if (secrets?.unopenedSecrets.length) {
    // Sealed with the other server's key: the plugin needs them entered again.
    context.print('These plugin settings could not be opened on this server, so enter them again in each plugin:');
    for (const { plugin, setting } of secrets.unopenedSecrets) context.print(`  ${printable(plugin)}: ${printable(setting)}`);
    context.print('Issue new recovery codes under Security: the ones you have were made on the old server.');
  } else if (secrets?.sealedSecrets === 0) {
    context.print('If this backup came from another server, issue new recovery codes under Security.');
  }
  return 0;
}

function counts(records: BackupRecordCounts): string {
  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  return [plural(records.posts, 'post', 'posts'), plural(records.pages, 'page', 'pages'), plural(records.mediaItems, 'media item', 'media items')].join(', ');
}
