import { lstat, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { CliContext } from './main.js';
import { findUnsafeEntry } from './ownership.js';
import { printable } from './output.js';

// A Markdown archive goes through the system tar, by argv: bsdtar on a Mac, GNU tar on the server.

/** What an import takes: the archive, what it unpacks to, and its entries. */
export const ARCHIVE_LIMITS = { bytes: 2 * 1024 ** 3, entries: 20_000 } as const;
const TAR_MS = 10 * 60_000;

export interface ArchiveEntry {
  type: 'file' | 'dir' | 'other';
  name: string;
  size: number;
}

/** A refusal of the archive, as the sentence the owner reads. */
export class ArchiveRefusal extends Error {}

type Commands = Pick<CliContext, 'runCommand' | 'streamCommand'>;

const tooLarge = () => new ArchiveRefusal('That archive is larger than 2 GiB, or holds more than 20,000 entries.');
const unreadable = () => new ArchiveRefusal('That archive could not be read as a .tar.gz, so nothing was imported.');

// `tar --numeric-owner -tv` prints a line like `ls -l`: the mode, whose first letter is the type, the
// owner as numbers, the size and the time, and the name last. GNU: `-rw------- 0/0 10 2026-10-03 12:00 name`.
// bsdtar: `-rw-------  0 0      0 10 Oct  3 12:00 name`, with the year in place of the time when old.
// Every field before the name is digits or tar's own text: an owner's name, which the archive sets and
// tar does not escape, is never printed, so nothing in the archive can shift where the name starts.
const GNU_LINE = /^(\S)\S{9} +\d+\/\d+ +(\d+|\d+,\d+) \d{4}-\d\d-\d\d \d\d:\d\d(?::\d\d)? (.*)$/u;
const BSD_LINE = /^(\S)\S{9} +\d+ +\d+ +\d+ +(\d+|\d+, *\d+) \S+ +\d{1,2} +(?:\d\d:\d\d|\d{4}) (.*)$/u;
const C_ESCAPES: Record<string, number> = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, '\\': 92 };

/** One line of the listing, or null when it is not one tome can read. */
function parseLine(line: string): ArchiveEntry | null {
  const match = GNU_LINE.exec(line) ?? BSD_LINE.exec(line);
  if (!match) return null;
  const [, letter, size, name] = match as unknown as [string, string, string, string];
  const type = letter === '-' ? 'file' : letter === 'd' ? 'dir' : 'other';
  // A link's line goes on to its target. Only the name is shown, and a link is refused either way.
  const link = letter === 'l' ? ' -> ' : letter === 'h' ? ' link to ' : null;
  const shown = link && name.includes(link) ? name.slice(0, name.indexOf(link)) : name;
  return { type, name: unescapeName(shown), size: type === 'file' ? Number(size) : 0 };
}

/**
 * Both tars print a byte they will not show (Thai, outside a UTF-8 locale) as `\ooo`, and a
 * backslash as `\\`. The name, back as the bytes it is.
 */
function unescapeName(text: string): string {
  const pieces: Buffer[] = [];
  let last = 0;
  for (const match of text.matchAll(/\\([0-7]{3}|.)/gu)) {
    const code = match[1]!;
    const byte = code.length === 3 ? Number.parseInt(code, 8) : C_ESCAPES[code];
    if (byte === undefined || byte > 255) continue;
    pieces.push(Buffer.from(text.slice(last, match.index), 'utf8'), Buffer.from([byte]));
    last = match.index + match[0].length;
  }
  pieces.push(Buffer.from(text.slice(last), 'utf8'));
  return Buffer.concat(pieces).toString('utf8');
}

/**
 * The entries of a .tar.gz, from `tar -tvzf`, read line by line however long the listing is. It stops
 * one entry past `maxEntries`, which `assertSafeEntries` then refuses, so a huge listing is never held
 * whole. A listing that ends badly or holds a line it cannot read is refused, never trusted in part.
 */
export async function listArchive(commands: Commands, path: string, maxEntries: number = ARCHIVE_LIMITS.entries): Promise<ArchiveEntry[]> {
  if ((await stat(path)).size > ARCHIVE_LIMITS.bytes) throw tooLarge();
  const entries: ArchiveEntry[] = [];
  const stop = new AbortController();
  let unread = false;
  let code: number;
  try {
    code = await commands.streamCommand('tar', ['--numeric-owner', '-tvzf', path], (line, stream) => {
      if (stream !== 'stdout' || stop.signal.aborted) return;
      const entry = parseLine(line);
      if (entry) entries.push(entry);
      else unread = true;
      if (unread || entries.length > maxEntries) stop.abort();
    }, { timeoutMs: TAR_MS, signal: stop.signal });
  } catch (error) {
    if (!stop.signal.aborted) throw error;
    code = 0;
  }
  if (unread || code !== 0) throw unreadable();
  return entries;
}

/** Refuses an archive with a path that leads outside it, a link or special file, or that is too big. */
export function assertSafeEntries(entries: readonly ArchiveEntry[], limits: { bytes: number; entries: number } = ARCHIVE_LIMITS): void {
  let total = 0;
  for (const entry of entries) {
    if (entry.name.startsWith('/') || entry.name.split('/').includes('..')) {
      throw new ArchiveRefusal(`That archive holds a path outside itself (${printable(entry.name)}), so nothing was imported.`);
    }
    if (entry.type === 'other') throw new ArchiveRefusal(`That archive holds a link or a special file (${printable(entry.name)}), so nothing was imported.`);
    total += entry.size;
  }
  if (entries.length > limits.entries || total > limits.bytes) throw tooLarge();
}

/**
 * Unpacks an archive whose listing passed, as root, owning nothing and keeping no permission bits,
 * then walks what it left: anything but a plain file or a directory is refused, and so is more than
 * 2 GiB on disk, whatever sizes the listing gave.
 */
export async function extractArchive(commands: Commands, path: string, directory: string): Promise<void> {
  const result = await commands.runCommand('tar', ['-xzf', path, '-C', directory, '--no-same-owner', '--no-same-permissions'], { timeoutMs: TAR_MS });
  if (result.code !== 0) throw unreadable();
  const unsafe = await findUnsafeEntry(directory);
  if (unsafe !== null) throw new ArchiveRefusal(`That archive holds a link or a special file (${printable(unsafe)}), so nothing was imported.`);
  let total = 0;
  for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
    total += (await lstat(join(entry.parentPath, entry.name))).size;
  }
  if (total > ARCHIVE_LIMITS.bytes) throw tooLarge();
}

/**
 * Packs a directory's contents into a new .tar.gz, made 0600 before tar writes a byte to it. An archive
 * already there is never touched (EEXIST); one this call made is removed when tar fails, so a disk that
 * filled up leaves no cut-off archive that looks like an export.
 */
export async function packDirectory(commands: Commands, directory: string, out: string): Promise<void> {
  await writeFile(out, '', { mode: 0o600, flag: 'wx' });
  let result;
  try {
    result = await commands.runCommand('tar', ['-czf', out, '-C', directory, '.'], { timeoutMs: TAR_MS });
  } catch (error) {
    await rm(out, { force: true });
    throw error;
  }
  if (result.code !== 0) {
    await rm(out, { force: true });
    throw new Error(printable(result.stderr.trim()).slice(0, 200) || `tar exited with ${result.code}`);
  }
}
