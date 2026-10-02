import { redactDiagnosticText } from '../updater/process.js';

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

/** The line for an update job's phase, "[2/8] Verify the official update", or null at its end. */
export function updateStep(phase: string, completedSteps: number, totalSteps: number): string | null {
  if (phase === 'rolling_back') return 'Restoring the previous version';
  const name = updateSteps[phase];
  return name ? `[${completedSteps + 1}/${totalSteps}] ${name}` : null;
}

/** The line for a backup's phase, "[2/3] Create the backup", or null at its end. */
export function backupStep(phase: string): string | null {
  const names = Object.keys(backupSteps);
  const index = names.indexOf(phase);
  return index < 0 ? null : `[${index + 1}/${names.length}] ${backupSteps[phase]}`;
}

/** What an updater error code means, and what to do about it. */
export function explainError(code: string | null, job: 'update' | 'backup', disk: { backupDirectory: string; minimumFreeBytes: number }): string {
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

/**
 * A line of logs with every secret replaced by "[redacted]", through the updater's own redaction.
 * A line it cannot check (too long, or a secret it cannot match safely) is hidden whole.
 */
export function redactLine(line: string, secrets: readonly string[]): string {
  if (secrets.length === 0) return line;
  return redactDiagnosticText(line, secrets, 64 * 1024) ?? '[line hidden: it could not be checked for secrets]';
}
