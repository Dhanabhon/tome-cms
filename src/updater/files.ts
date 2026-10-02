import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** The bytes in a backup's files, as written; links are not followed. */
export async function directorySize(path: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(path, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) total += (await lstat(join(entry.parentPath, entry.name))).size;
  }
  return total;
}

/**
 * A backup's `manifest.json`, read without following a link, only when it is a regular file of at
 * most 32 MiB. The app's one-shot container writes that directory, so nothing in it is trusted.
 */
export async function readManifestBytes(directory: string): Promise<Buffer> {
  const file = await open(join(directory, 'manifest.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const metadata = await file.stat();
    // ponytail: 32 MiB manifest ceiling; stream validation if object inventories exceed it.
    if (!metadata.isFile() || metadata.size > 32 * 1024 ** 2) throw new Error('Invalid backup manifest');
    return await file.readFile();
  } finally {
    await file.close();
  }
}
