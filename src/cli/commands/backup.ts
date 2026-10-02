import type { BackupJob } from '../../updater/state.js';
import type { CliContext } from '../main.js';
import { backupStep, explainError, formatBytes, formatMinutes } from '../output.js';
import { errorCodeOf, follow, isBackupRunning, isBackupStuck, postJob, readBackup, refusal, stuckBackupAdvice } from '../socket.js';

/** Asks the updater for a backup and follows it to its end. The site is in maintenance meanwhile. */
export async function backup(context: CliContext, options: { full: boolean; yes: boolean }): Promise<number> {
  const kind = options.full ? 'full' : 'database';
  if (!options.yes) {
    const last = await readBackup(context.socket);
    const took = last?.phase === 'succeeded' && last.finishedAt
      ? `, about ${formatMinutes(Date.parse(last.finishedAt) - Date.parse(last.startedAt))} last time` : ', for a few minutes';
    const what = options.full ? 'the database and media' : 'the database';
    if (!await context.confirm(`Back up ${what}? The site is in maintenance while it runs${took}. [y/N] `)) {
      context.print('Nothing was done.');
      return 1;
    }
  }

  const id = context.requestId();
  const answer = await postJob(context.socket, context.sleep, '/v1/backup', { requestId: id, kind });
  if (answer.status !== 202 && answer.status !== 200) {
    const code = errorCodeOf(answer);
    context.warn(code === 'insufficient_disk_space'
      ? explainError(code, 'backup', context.config)
      : await refusal(context.socket, answer) ?? `The updater refused the backup (${code ?? answer.status}).`);
    return 1;
  }

  const ended = await follow(context, async () => {
    const record = await readBackup(context.socket);
    if (record?.id !== id) throw new Error('The updater is following another backup');
    return record;
  }, (record) => backupStep(record.phase), async (record) => !isBackupRunning(record) || await isBackupStuck(context.socket, record));
  return report(context, ended, kind);
}

function report(context: CliContext, record: BackupJob, asked: 'database' | 'full'): number {
  if (isBackupRunning(record)) {
    context.warn(stuckBackupAdvice(record.phase));
    return 1;
  }
  if (record.phase === 'failed') {
    context.warn(explainError(record.errorCode, 'backup', context.config));
    return 1;
  }
  if (record.kind !== asked) context.print('This app is older than 1.3.0 and cannot back up the database alone, so the updater backed up everything.');
  const size = record.sizeBytes === null ? 'size unknown' : formatBytes(record.sizeBytes);
  context.print(`Backup saved to ${record.backupDirectory} (${size}).`);
  return 0;
}
