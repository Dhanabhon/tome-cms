import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';

import type { CliContext } from './main.js';

/**
 * The backup directory named, by its real path, when that is a directory under the backup root and
 * not the root itself, as the updater requires. It throws otherwise, also when it does not exist.
 */
export async function assertUnderBackupRoot(root: string, path: string): Promise<string> {
  const real = await realpath(path);
  const tail = relative(await realpath(root), real);
  if (!tail || tail === '..' || tail.startsWith(`..${sep}`) || isAbsolute(tail) || !(await stat(real)).isDirectory()) {
    throw new Error('Not a backup directory under the backup root');
  }
  return real;
}

/** Who owns the backup root (`tomecms-updater`), by number, as the updater and its one-shots run. */
export async function ownerOfBackupRoot(root: string): Promise<{ uid: number; gid: number }> {
  const { uid, gid } = await stat(root);
  return { uid, gid };
}

/**
 * Hands a whole backup to `owner`. One copied in by rsync as root arrives root-owned, and the
 * updater, which is not root, could not read it. Links are changed themselves, never followed.
 */
export async function chownTree(runCommand: CliContext['runCommand'], path: string, owner: { uid: number; gid: number }): Promise<void> {
  const result = await runCommand('chown', ['-R', '--no-dereference', `${owner.uid}:${owner.gid}`, path], { timeoutMs: 10 * 60_000 });
  if (result.code !== 0) throw new Error(`chown exited with ${result.code}`);
}
