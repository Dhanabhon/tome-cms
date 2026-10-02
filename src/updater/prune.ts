import { OFFICIAL_IMAGE_REPOSITORY } from '../update/contracts.js';
import type { CommandDiagnosticContext, CommandDiagnosticStage } from './process.js';

type DockerCommand = (stage: CommandDiagnosticStage, args: readonly string[], timeoutMs: number) => Promise<string>;

/** What a clean-up found to remove, with Docker's size of each in bytes, and what it removed. */
export interface PruneResult {
  candidates: Array<{ id: string; size: number | null }>;
  removed: string[];
}

interface ImageRow { digest: string; id: string; repository: string; tag: unknown; size: number | null; createdAt: number | null }

const digest = /^sha256:[0-9a-f]{64}$/;

/**
 * Removes the official application images other than those in `keep`: after a success, the one
 * installed and the one before it, which a rollback needs. Nothing else is touched, not the
 * database's or the storage's images. Each image left behind by an update is about 750 MB, and a
 * server that never removed them filled its disk. Only an untagged image is ever removed: the
 * updater pulls by digest alone, so a tag means someone pulled or built that image on purpose.
 * Best effort: a removal Docker refuses (a stopped container still uses the image) is journalled by
 * the command diagnostics and skipped, and nothing here throws. Null means the listing could not be
 * read, and nothing was removed.
 *
 * `previousUnknownFor` is the installed digest when nothing says which image ran before it (no
 * update since the install, or the last one rolled back). Then the image built just before the
 * installed one is kept as the likely previous one, and so is every image built after it; only
 * images older than both go. A date that cannot be read keeps everything.
 */
export async function pruneOldImages(
  command: DockerCommand,
  keep: readonly string[],
  diagnostics: CommandDiagnosticContext,
  options: { dryRun?: boolean; previousUnknownFor?: string } = {},
): Promise<PruneResult | null> {
  try {
    // Without --digests, `Digest` is empty: an image pulled by digest has no tag to tell it by.
    const listing = await command('cleanup.image.list',
      ['image', 'ls', '--no-trunc', '--digests', '--format', '{{json .}}', OFFICIAL_IMAGE_REPOSITORY], 30_000);
    const parsed = listing.split('\n').filter((line) => line.trim()).map(imageRow);
    // One line that cannot be read means the listing cannot be trusted: it may be the very row that says keep.
    if (parsed.includes(null)) return unreadable(diagnostics);
    const rows = parsed.flatMap((row) => row ?? []).filter((row) => row.repository === OFFICIAL_IMAGE_REPOSITORY && digest.test(row.id));
    // Kept: an image under a kept digest (one image can carry several), and any tagged one.
    const kept = new Set(rows.filter((row) => keep.includes(row.digest) || row.tag !== '<none>' || !digest.test(row.digest))
      .map((row) => row.id));
    if (options.previousUnknownFor) {
      const likely = keptByAge(rows, kept, options.previousUnknownFor);
      if (!likely) return unreadable(diagnostics);
      for (const id of likely) kept.add(id);
    }
    const candidates = [...new Map(rows.filter((row) => !kept.has(row.id)).map((row) => [row.id, { id: row.id, size: row.size }])).values()];
    const removed: string[] = [];
    if (options.dryRun) return { candidates, removed };
    for (const { id } of candidates) {
      try {
        await command('cleanup.image.remove', ['image', 'rm', id], 60_000);
        removed.push(id);
        journal('updater_image_removed', 'cleanup.image.remove', diagnostics, { imageId: id, result: 'removed' });
      } catch { /* Journalled by the command diagnostics; the next image is still tried. */ }
    }
    return { candidates, removed };
  } catch {
    // An update has already succeeded; a clean-up that cannot run waits for the next one.
    return null;
  }
}

/** The images to keep, by build date, when the previous one is not known; null when the dates do not say. */
function keptByAge(rows: readonly ImageRow[], kept: ReadonlySet<string>, installedDigest: string): string[] | null {
  const installed = rows.find((row) => row.digest === installedDigest)?.createdAt;
  const removable = rows.filter((row) => !kept.has(row.id));
  if (installed == null || removable.some((row) => row.createdAt === null)) return null;
  const newer = removable.filter((row) => row.createdAt! >= installed);
  const older = removable.filter((row) => row.createdAt! < installed).sort((a, b) => b.createdAt! - a.createdAt!);
  return [...newer, ...older.slice(0, 1)].map((row) => row.id);
}

function unreadable(diagnostics: CommandDiagnosticContext): null {
  journal('updater_image_listing_unreadable', 'cleanup.image.list', diagnostics);
  return null;
}

/** One listing line, or null when it is not a JSON object with the fields Docker always writes. */
function imageRow(line: string): ImageRow | null {
  try {
    const row: unknown = JSON.parse(line);
    if (!row || typeof row !== 'object') return null;
    const { Repository, Digest, ID, Tag, Size, CreatedAt } = row as Record<string, unknown>;
    return typeof Repository === 'string' && typeof Digest === 'string' && typeof ID === 'string'
      ? { digest: Digest, id: ID, repository: Repository, tag: Tag, size: bytes(Size), createdAt: created(CreatedAt) } : null;
  } catch {
    return null;
  }
}

// Docker prints sizes in decimal units to three or four significant digits ("763MB", "1.2GB"), so
// a size here is close, not exact. One it does not print that way is unknown, which removes nothing less.
const units: Record<string, number> = { B: 1, kB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 };
function bytes(value: unknown): number | null {
  const match = typeof value === 'string' ? /^(\d+(?:\.\d+)?)(B|kB|MB|GB|TB)$/.exec(value) : null;
  return match ? Math.round(Number(match[1]) * units[match[2]!]!) : null;
}

/** Docker's "2026-10-02 05:59:08 +0000 UTC", as milliseconds; null for anything else. */
function created(value: unknown): number | null {
  const match = typeof value === 'string'
    ? /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.\d+)? ([+-]\d{2})(\d{2})(?: \S+)?$/.exec(value) : null;
  const time = match ? Date.parse(`${match[1]}T${match[2]}${match[3]}:${match[4]}`) : NaN;
  return Number.isFinite(time) ? time : null;
}

function journal(event: string, stage: CommandDiagnosticStage, diagnostics: CommandDiagnosticContext, detail: object = {}): void {
  const line = JSON.stringify({ event, jobId: diagnostics.jobId, targetVersion: diagnostics.targetVersion, stage, ...detail });
  try {
    if (event === 'updater_image_removed') console.info(line);
    else console.error(line);
  } catch { /* Logging cannot fail an update that succeeded. */ }
}
