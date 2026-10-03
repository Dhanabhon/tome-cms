import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

import type { CliContext } from './main.js';
import { printable } from './output.js';

/**
 * The backup directory named, by its real path, when that is a directory directly in the backup
 * root, where `tome backup` and the updater put every backup. It throws otherwise: a plain Error when
 * it is somewhere else or not a directory, and the file system's own (ENOENT, EACCES) when it cannot
 * be resolved.
 */
export async function assertUnderBackupRoot(root: string, path: string): Promise<string> {
  const { real, isDirectory } = await inBackupRoot(root, path);
  if (!isDirectory) throw new Error('Not a backup directory in the backup root');
  return real;
}

/**
 * What a path names, by its real path, when that is directly in the backup root: a backup, an
 * archive, or a directory laid out like one. It throws as `assertUnderBackupRoot` does.
 */
export async function inBackupRoot(root: string, path: string): Promise<{ real: string; isDirectory: boolean; isFile: boolean }> {
  const real = await realpath(path);
  // Only the thing itself is handed to the updater's user, so a directory between it and the root
  // would be one the updater may not be able to enter.
  if (dirname(real) !== await realpath(root)) throw new Error('Not in the backup root');
  const metadata = await stat(real);
  return { real, isDirectory: metadata.isDirectory(), isFile: metadata.isFile() };
}

/**
 * The first entry in a backup, by its path relative to it, that is a link, a file with another hard
 * link, or anything but a plain file or directory; null when there is none. `chown -R
 * --no-dereference` already changes links rather than what they point to, so this is defence in
 * depth: the updater's user is in the docker group, so handing it a link or a hard link to a file
 * outside the backup, such as /etc/shadow, would hand it that file. Nothing in a real backup is one.
 */
export async function findUnsafeEntry(directory: string): Promise<string | null> {
  for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    const metadata = await lstat(path);
    if (metadata.isDirectory()) continue;
    if (!metadata.isFile() || metadata.nlink > 1) return relative(directory, path);
  }
  return null;
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
  if (result.code !== 0) throw new Error(printable(result.stderr.trim()).slice(0, 200) || `chown exited with ${result.code}`);
}
