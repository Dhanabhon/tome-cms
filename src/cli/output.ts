import { redactDiagnosticText } from '../updater/process.js';
import type { RestoreJob } from '../updater/state.js';

// Plain text only: no colour codes, so the output reads the same in a terminal, a pipe or a log.

const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];

/** 1536 → "1.5 KiB": one decimal below 100, none above; binary units, as `df -h` shows them. */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  if (unit === 0) return `${bytes} B`;
  return `${value < 100 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** A value read from somewhere tome does not trust, with its C0 and C1 control characters (escape sequences) taken out. */
export function printable(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, '');
}

/** How long ago, in the largest whole unit: "3 minutes ago", "2 days ago". */
export function formatAge(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 60_000));
  const [count, unit] = minutes < 60 ? [minutes, 'minute'] : minutes < 1440 ? [Math.floor(minutes / 60), 'hour'] : [Math.floor(minutes / 1440), 'day'];
  if (unit === 'minute' && count === 0) return 'just now';
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

/** A duration in whole minutes, at least one: "about 3 minutes". */
export function formatMinutes(milliseconds: number): string {
  const minutes = Math.max(1, Math.round(milliseconds / 60_000));
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/** "2026-10-02 18:05", in the server's own time zone. */
export function localTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// The step names System shows (src/lib/admin-i18n.ts, `updates`), so the two read alike.
const updateSteps: Record<string, string> = {
  preflight: 'Check prerequisites',
  verifying: 'Verify the official update',
  downloading: 'Download update',
  quiescing: 'Prepare maintenance',
  backing_up: 'Create recovery backup',
  migrating: 'Apply database migrations',
  restarting: 'Restart TomeCMS',
  health_check: 'Check application health',
};
const backupSteps: Record<string, string> = {
  quiescing: 'Prepare maintenance',
  backing_up: 'Create the backup',
  restarting: 'Restart TomeCMS',
};
// Every step a restore can take; `migrating` only when the backup is older, so its number may be skipped.
const restoreSteps: Record<string, string> = {
  verifying: 'Check the backup',
  quiescing: 'Prepare maintenance',
  safety_backup: 'Create the safety backup',
  restoring: 'Restore the backup',
  migrating: 'Apply database migrations',
  restarting: 'Restart TomeCMS',
  checking: 'Check the restored site',
};

/** The line for an update job's phase, "[2/8] Verify the official update", or null at its end. */
export function updateStep(phase: string, completedSteps: number, totalSteps: number): string | null {
  if (phase === 'rolling_back') return 'Restoring the previous version';
  const name = updateSteps[phase];
  return name ? `[${completedSteps + 1}/${totalSteps}] ${name}` : null;
}

/** The line for a backup's phase, "[2/3] Create the backup", or null at its end. */
export function backupStep(phase: string): string | null {
  return numberedStep(backupSteps, phase);
}

/** The line for a restore's phase, "[3/7] Create the safety backup", or null at its end. */
export function restoreStep(phase: string): string | null {
  if (phase === 'rolling_back') return 'Putting the safety backup back';
  return numberedStep(restoreSteps, phase);
}

function numberedStep(steps: Record<string, string>, phase: string): string | null {
  const names = Object.keys(steps);
  const index = names.indexOf(phase);
  return index < 0 ? null : `[${index + 1}/${names.length}] ${steps[phase]}`;
}

/** What an updater error code means, and what to do about it. */
export function explainError(code: string | null, job: 'update' | 'backup' | 'restore', disk: { backupDirectory: string; minimumFreeBytes: number }): string {
  const logs = 'See what happened with: sudo tome logs updater';
  if (code === 'insufficient_disk_space') {
    return `Not enough free disk space where backups go (${disk.backupDirectory}): it needs ${formatBytes(disk.minimumFreeBytes)}. ` +
      'See which old images can go with: sudo tome prune';
  }
  if (job === 'backup') {
    if (code === 'preflight_failed') return `The backup did not start: the server is not as the updater expects (its files, or the running app's image). Nothing was stopped. ${logs}`;
    if (code === 'health_failed') return 'The backup was taken, but the site did not become ready again afterwards. See why with: sudo tome logs app';
    return `The backup failed. The site was started again. ${logs}`;
  }
  if (job === 'restore') {
    const sentences: Record<string, string> = {
      backup_invalid: `The backup did not pass its checks (a file is missing, or does not match its checksum), so nothing was changed. ${logs}`,
      backup_other_site: 'That backup is from another site, and a restore keeps the site\'s address, so nothing was changed.',
      backup_too_new: 'That backup is from a newer TomeCMS than this site runs, so nothing was changed. Update the site first: sudo tome update',
      app_too_old: 'This site runs a TomeCMS older than 1.13.0, which cannot restore, so nothing was changed. Update it first: sudo tome update',
      safety_backup_failed: `The safety backup before the restore failed, so nothing was replaced. ${logs}`,
      restore_failed: `The restore failed, so the safety backup was put back. ${logs}`,
      rollback_failed: `The restore failed, and the safety backup could not be put back either. The site stays in maintenance. ${logs}`,
      interrupted: `The updater stopped in the middle of the restore. When it started again, it put the site back as it was before. ${logs}`,
      preflight_failed: `The restore did not start: the server is not as the updater expects (its files, or the app's image). Nothing was changed. ${logs}`,
    };
    return (code && sentences[code]) ?? `The restore failed${code ? ` (${code})` : ''}. ${logs}`;
  }
  const sentences: Record<string, string> = {
    release_unavailable: 'The release could not be fetched from GitHub. Check the server\'s network, then try again.',
    incompatible_update: 'This release cannot be installed on this server directly. Read its release notes.',
    verification_failed: 'The release did not pass verification, so nothing was installed. Try again later, and report it if it repeats.',
    download_failed: 'The release image could not be downloaded. Check the server\'s network and free disk, then try again.',
    preflight_failed: `The server is not as the updater expects (its files, or the running app's image), so nothing was changed. ${logs}`,
    backup_failed: `The backup before the update failed, so nothing was changed. ${logs}`,
    migration_failed: `The database migration failed. ${logs}`,
    health_failed: 'The new version did not become ready. See why with: sudo tome logs app',
    manual_recovery_required: 'The updater needs manual recovery. Follow "Troubleshooting" in the TomeCMS documentation.',
  };
  return (code && sentences[code]) ?? `The update failed${code ? ` (${code})` : ''}. ${logs}`;
}

/** The one sentence for a site that cannot export or import right now. */
export const TRANSFER_BUSY = 'The site is in maintenance, or the updater is busy. Try again when it is done.';

/**
 * What a refusal from the image's export or import step means, from its receipt's code and the file
 * and field it names; null for a code that is not a refusal, but a failure.
 */
export function explainContentRefusal(code: string, detail: { file?: unknown; field?: unknown; mediaId?: unknown }): string | null {
  const shown = (value: unknown, otherwise: string) => typeof value === 'string' && value ? printable(value) : otherwise;
  const file = shown(detail.file, 'A file');
  const sentences: Record<string, string> = {
    media_too_large: `${file} is larger than the File Manager accepts for its kind.`,
    front_matter_invalid: `${file} has front matter TomeCMS cannot read: ${shown(detail.field, 'the block between the --- lines')}.`,
    media_type_unsupported: `${file} is not a picture or a document the File Manager accepts.`,
    content_invalid: `${file} holds content TomeCMS cannot accept, such as a slug that is too long or a document that does not read.`,
    layout_invalid: `${file} does not fit the archive's layout: manifest.json, media/, and posts/ or pages/ in th/ or en/.`,
    manifest_invalid: 'manifest.json does not read as a TomeCMS Markdown archive\'s.',
    site_busy: TRANSFER_BUSY,
    site_not_installed: 'This site is not set up yet. Finish setting it up in the browser first.',
    media_missing: `A media file the content uses (${shown(detail.mediaId, 'unknown')}) is missing from storage, so nothing was exported.`,
  };
  return Object.hasOwn(sentences, code) ? sentences[code]! : null;
}

/**
 * The way out of a restore that ended with the site in maintenance and the app stopped (its record's
 * `maintenanceKept`): every job is refused until `updater:clear-failed` sets it aside.
 */
export function manualRecovery(restore: Pick<RestoreJob, 'errorCode' | 'backupDirectory' | 'safetyBackupDirectory'>): string[] {
  const states: Record<string, string> = {
    rollback_failed: 'Neither the backup nor the safety backup could be put back, so no one knows what state the database is in.',
    restore_failed: 'The safety backup was put back, so the database is as it was before the restore. The restore found the app stopped, so it left it so.',
    interrupted: 'The restore was cut off when the updater stopped. When it started again, the safety backup was put back, so the database is as it was before the restore. The app was left stopped.',
    safety_backup_failed: 'Nothing was replaced, so the database is as it was before the restore. The restore found the app stopped, so it left it so.',
  };
  const safety = restore.safetyBackupDirectory === null ? null : printable(restore.safetyBackupDirectory);
  return [
    'The site stays in maintenance, and the app is stopped.',
    (restore.errorCode && states[restore.errorCode]) ?? 'No one knows what state the database is in.',
    `The backup it was restoring: ${printable(restore.backupDirectory)}`,
    safety ? `The safety backup, taken just before: ${safety}` : 'There is no safety backup.',
    'To recover:',
    '  1. From a checkout of v1.13.0 or newer, run: sudo npm run updater:clear-failed',
    '     It sets the failed restore aside and takes the site out of maintenance. The app stays stopped.',
    safety
      ? `  2. Then put the safety backup back, which starts the app: sudo tome restore ${safety}`
      : '  2. Then restore the newest backup, which starts the app (sudo tome status shows it): sudo tome restore <newest backup>',
  ];
}

/**
 * Why the updater's redaction can never hide these secrets, or null when it can. Its limits: at most
 * 64 secrets, each of 8 to 4096 bytes, none that "[redacted]" itself contains.
 */
export function redactionProblem(secrets: readonly string[]): string | null {
  if (secrets.length > 64) return 'more than 64 secrets';
  if (secrets.some((secret) => Buffer.byteLength(secret) < 8)) return 'a secret shorter than 8 bytes';
  if (secrets.some((secret) => Buffer.byteLength(secret) > 4096)) return 'a secret longer than 4096 bytes';
  if (secrets.length && redactDiagnosticText('', secrets) === null) return 'a secret that cannot be matched safely';
  return null;
}

/**
 * A line of logs with every secret replaced by "[redacted]", through the updater's own redaction.
 * Only a line too long to check (32 KiB or more) is hidden whole.
 */
export function redactLine(line: string, secrets: readonly string[]): string {
  if (secrets.length === 0) return line;
  return redactDiagnosticText(line, secrets, 64 * 1024) ?? '[line hidden: too long to check for secrets]';
}
