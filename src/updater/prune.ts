import { OFFICIAL_IMAGE_REPOSITORY } from '../update/contracts.js';
import type { CommandDiagnosticContext, CommandDiagnosticStage } from './process.js';

type DockerCommand = (stage: CommandDiagnosticStage, args: readonly string[], timeoutMs: number) => Promise<string>;

const digest = /^sha256:[0-9a-f]{64}$/;

/**
 * Removes the official application images other than those in `keep`: after a success, the one
 * installed and the one before it, which a rollback needs. Nothing else is touched, not the
 * database's or the storage's images. Each image left behind by an update is about 750 MB, and a
 * server that never removed them filled its disk. Only an untagged image is ever removed: the
 * updater pulls by digest alone, so a tag means someone pulled or built that image on purpose.
 * Best effort: the update has already succeeded, a removal Docker refuses (a stopped container
 * still uses the image) is journalled by the command diagnostics and skipped, and nothing here throws.
 */
export async function pruneOldImages(
  command: DockerCommand,
  keep: readonly string[],
  diagnostics: CommandDiagnosticContext,
): Promise<void> {
  try {
    // Without --digests, `Digest` is empty: an image pulled by digest has no tag to tell it by.
    const listing = await command('cleanup.image.list',
      ['image', 'ls', '--no-trunc', '--digests', '--format', '{{json .}}', OFFICIAL_IMAGE_REPOSITORY], 30_000);
    const rows = listing.split('\n').flatMap(imageRow);
    if (rows.length === 0 && listing.trim()) journal('updater_image_listing_unreadable', 'cleanup.image.list', diagnostics);
    // Kept: an image under a kept digest (one image can carry several), and any tagged one.
    const kept = new Set(rows.filter((row) => keep.includes(row.digest) || row.tag !== '<none>' || !digest.test(row.digest))
      .map((row) => row.id));
    for (const id of new Set(rows.map((row) => row.id).filter((id) => !kept.has(id)))) {
      try {
        await command('cleanup.image.remove', ['image', 'rm', id], 60_000);
        journal('updater_image_removed', 'cleanup.image.remove', diagnostics, { imageId: id, result: 'removed' });
      } catch { /* Journalled by the command diagnostics; the next image is still tried. */ }
    }
  } catch { /* The update has succeeded; a clean-up that cannot run waits for the next one. */ }
}

function imageRow(line: string): Array<{ digest: string; id: string; tag: unknown }> {
  try {
    const row: unknown = JSON.parse(line);
    if (!row || typeof row !== 'object') return [];
    const { Repository, Digest, ID, Tag } = row as Record<string, unknown>;
    return Repository === OFFICIAL_IMAGE_REPOSITORY && typeof Digest === 'string' &&
      typeof ID === 'string' && digest.test(ID) ? [{ digest: Digest, id: ID, tag: Tag }] : [];
  } catch {
    return [];
  }
}

function journal(event: string, stage: CommandDiagnosticStage, diagnostics: CommandDiagnosticContext, detail: object = {}): void {
  const line = JSON.stringify({ event, jobId: diagnostics.jobId, targetVersion: diagnostics.targetVersion, stage, ...detail });
  try {
    if (event === 'updater_image_removed') console.info(line);
    else console.error(line);
  } catch { /* Logging cannot fail an update that succeeded. */ }
}
