/** When each phase of an update began, as the updater keeps it since 1.3.0. */
export interface UpdateTimeline {
  backupKind: 'full' | 'database' | null;
  timeline: Array<{ phase: string; at: string }>;
}

export interface UpdateDurations {
  backupKind: UpdateTimeline['backupKind'];
  /** From the moment the site went into maintenance to the end of the update. */
  offlineSeconds: number;
  backupSeconds: number | null;
}

const seconds = (from: string, to: string) => Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000));

/**
 * How long a finished update kept the site offline, and how much of that was the backup. Null when
 * that was not measured: an updater from before 1.3.0, an update still running, or one that stopped
 * before the site went down.
 */
export function updateDurations(
  job: { finishedAt: string | null; phase: string },
  detail: UpdateTimeline | null,
): UpdateDurations | null {
  if (!detail || !job.finishedAt) return null;
  const began = (phase: string) => detail.timeline.find((entry) => entry.phase === phase)?.at;
  const offline = began('quiescing');
  if (!offline) return null;
  // The backup lasts until whatever came next: the migration, or a rollback when it failed.
  const backup = detail.timeline.findIndex((entry) => entry.phase === 'backing_up');
  const next = backup >= 0 ? detail.timeline[backup + 1] : undefined;
  return {
    backupKind: detail.backupKind,
    offlineSeconds: seconds(offline, job.finishedAt),
    backupSeconds: next ? seconds(detail.timeline[backup]!.at, next.at) : null,
  };
}
