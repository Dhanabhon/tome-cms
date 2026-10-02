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
    const parsed = listing.split('\n').filter((line) => line.trim()).map(imageRow);
    // One line that cannot be read means the listing cannot be trusted: it may be the very row that says keep.
    if (parsed.includes(null)) return journal('updater_image_listing_unreadable', 'cleanup.image.list', diagnostics);
    const rows = parsed.flatMap((row) => row ?? []).filter((row) => row.repository === OFFICIAL_IMAGE_REPOSITORY && digest.test(row.id));
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

/** One listing line, or null when it is not a JSON object with the fields Docker always writes. */
function imageRow(line: string): { digest: string; id: string; repository: string; tag: unknown } | null {
  try {
    const row: unknown = JSON.parse(line);
    if (!row || typeof row !== 'object') return null;
    const { Repository, Digest, ID, Tag } = row as Record<string, unknown>;
    return typeof Repository === 'string' && typeof Digest === 'string' && typeof ID === 'string'
      ? { digest: Digest, id: ID, repository: Repository, tag: Tag } : null;
  } catch {
    return null;
  }
}

function journal(event: string, stage: CommandDiagnosticStage, diagnostics: CommandDiagnosticContext, detail: object = {}): void {
  const line = JSON.stringify({ event, jobId: diagnostics.jobId, targetVersion: diagnostics.targetVersion, stage, ...detail });
  try {
    if (event === 'updater_image_removed') console.info(line);
    else console.error(line);
  } catch { /* Logging cannot fail an update that succeeded. */ }
}
