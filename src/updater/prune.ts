import { OFFICIAL_IMAGE_REPOSITORY } from '../update/contracts.js';
import type { CommandDiagnosticStage } from './process.js';

type DockerCommand = (stage: CommandDiagnosticStage, args: readonly string[], timeoutMs: number) => Promise<string>;

const digest = /^sha256:[0-9a-f]{64}$/;

/**
 * Removes the official application images other than those in `keep`: after a success, the one
 * installed and the one before it, which a rollback needs. Nothing else is touched, not the
 * database's or the storage's images. Each image left behind by an update is about 750 MB, and a
 * server that never removed them filled its disk. Best effort: the update has already succeeded, a
 * removal Docker refuses (a stopped container still uses the image) is journalled by the command
 * diagnostics and skipped, and nothing here throws.
 */
export async function pruneOldImages(command: DockerCommand, keep: readonly string[]): Promise<void> {
  let listing: string;
  try {
    // Without --digests, `Digest` is empty: an image pulled by digest has no tag to tell it by.
    listing = await command('cleanup.image.list',
      ['image', 'ls', '--no-trunc', '--digests', '--format', '{{json .}}', OFFICIAL_IMAGE_REPOSITORY], 30_000);
  } catch {
    return;
  }
  const rows = listing.split('\n').flatMap((line) => {
    try {
      const row: unknown = JSON.parse(line);
      if (!row || typeof row !== 'object') return [];
      const { Repository, Digest, ID } = row as Record<string, unknown>;
      return Repository === OFFICIAL_IMAGE_REPOSITORY && typeof Digest === 'string' &&
        typeof ID === 'string' && digest.test(ID) ? [{ digest: Digest, id: ID }] : [];
    } catch {
      return [];
    }
  });
  // One image can carry more than one digest, so it is kept when any of them is.
  const kept = new Set(rows.filter((row) => keep.includes(row.digest)).map((row) => row.id));
  const old = new Set(rows.filter((row) => digest.test(row.digest) && !kept.has(row.id)).map((row) => row.id));
  for (const id of old) await command('cleanup.image.remove', ['image', 'rm', id], 60_000).catch(() => undefined);
}
