import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import { ARCHIVE_LIMITS, ArchiveRefusal, assertSafeEntries, extractArchive, listArchive, packDirectory, type ArchiveEntry } from '../../src/cli/archive.js';
import { streamCommand } from '../../src/cli/main.js';
import { runCommand } from '../../src/updater/process.js';

// The system tar, as tome runs it: bsdtar on a Mac, GNU tar on the server.
const real = { runCommand, streamCommand };
const thai = 'ขนมปัง-ยามค่ำ.md';

async function scratch(t: { after: (fn: () => Promise<void>) => void }): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), 'tome-archive-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  return base;
}

/**
 * A .tar.gz with exactly these entries, written header by header, so an archive can hold what no
 * one could make on this machine without root: an absolute path, `..`, a device.
 */
function tarball(entries: Array<{ name: string; type?: string; body?: string; link?: string }>): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const body = Buffer.from(entry.body ?? '');
    const header = Buffer.alloc(512);
    const octal = (value: number, width: number) => `${value.toString(8).padStart(width - 1, '0')}\0`;
    header.write(entry.name, 0, 100, 'utf8');
    header.write(octal(0o644, 8), 100);
    header.write(octal(0, 8), 108);
    header.write(octal(0, 8), 116);
    header.write(octal(body.length, 12), 124);
    header.write(octal(1_790_000_000, 12), 136);
    header.write(entry.type ?? '0', 156);
    header.write(entry.link ?? '', 157, 100, 'utf8');
    header.write('ustar\0' + '00', 257);
    header.write(octal(1, 8), 329);
    header.write(octal(3, 8), 337);
    header.write(' '.repeat(8), 148);
    const sum = header.reduce((total, byte) => total + byte, 0);
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

async function archiveOf(t: Parameters<typeof scratch>[0], entries: Parameters<typeof tarball>[0]): Promise<string> {
  const path = join(await scratch(t), 'in.tar.gz');
  await writeFile(path, tarball(entries));
  return path;
}

function refusal(entries: ArchiveEntry[]): string | null {
  try {
    assertSafeEntries(entries);
    return null;
  } catch (error) {
    if (!(error instanceof ArchiveRefusal)) throw error;
    return error.message;
  }
}

test('an entry outside the archive, by .. or an absolute path, is refused before anything is unpacked', async (t) => {
  for (const name of ['../x', '/etc/x', 'posts/../../x']) {
    const entries = await listArchive(real, await archiveOf(t, [{ name: 'manifest.json', body: '{}' }, { name, body: 'x' }]));
    assert.equal(refusal(entries), `That archive holds a path outside itself (${name}), so nothing was imported.`, name);
  }
});

test('a symlink, a hard link, a FIFO and a device are refused', async (t) => {
  const kinds = [
    { name: 'media/link', type: '2', link: '/etc/shadow' },
    { name: 'media/hard', type: '1', link: 'manifest.json' },
    { name: 'media/fifo', type: '6' },
    { name: 'media/null', type: '3' },
    { name: 'media/disk', type: '4' },
  ];
  for (const kind of kinds) {
    const entries = await listArchive(real, await archiveOf(t, [{ name: 'manifest.json', body: '{}' }, kind]));
    assert.equal(refusal(entries), `That archive holds a link or a special file (${kind.name}), so nothing was imported.`, kind.name);
  }
});

test('more than 20,000 entries, or more than 2 GiB unpacked, is refused', () => {
  const sentence = 'That archive is larger than 2 GiB, or holds more than 20,000 entries.';
  const many = Array.from({ length: ARCHIVE_LIMITS.entries + 1 }, (_, index): ArchiveEntry => ({ type: 'file', name: `media/${index}`, size: 1 }));
  assert.equal(refusal(many), sentence);
  assert.equal(refusal(many.slice(1)), null, 'exactly 20,000 is fine');
  assert.equal(refusal([{ type: 'file', name: 'media/a', size: ARCHIVE_LIMITS.bytes }, { type: 'file', name: 'media/b', size: 1 }]), sentence);
});

test('a listing stops reading once it passes the entry limit, so a huge one is never held whole', async (t) => {
  let aborted = false;
  const flood = {
    runCommand,
    streamCommand: async (_executable: string, _args: readonly string[], onLine: (line: string, stream: 'stdout' | 'stderr') => void, options?: { signal?: AbortSignal }) => {
      for (let index = 0; index < 50_000 && !options?.signal?.aborted; index += 1) onLine(`-rw-r--r-- 0/0 1 2026-10-03 12:00 media/${index}`, 'stdout');
      aborted = options?.signal?.aborted === true;
      if (aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      return 0;
    },
  };
  const entries = await listArchive(flood, await archiveOf(t, []), 10);
  assert.equal(aborted, true);
  assert.equal(entries.length, 11, 'one past the limit, which the check then refuses');
});

test('an archive file over 2 GiB is refused before it is listed', async (t) => {
  const path = join(await scratch(t), 'big.tar.gz');
  await writeFile(path, '');
  await truncate(path, ARCHIVE_LIMITS.bytes + 1); // sparse: no disk is used
  const listed: string[] = [];
  const spy = { runCommand, streamCommand: async (executable: string) => { listed.push(executable); return 0; } };
  await assert.rejects(listArchive(spy, path),
    new ArchiveRefusal('That archive is larger than 2 GiB, or holds more than 20,000 entries.'));
  assert.deepEqual(listed, []);
});

test('something that is not a .tar.gz, or a listing tome cannot read, is refused rather than trusted', async (t) => {
  const path = join(await scratch(t), 'not.tar.gz');
  await writeFile(path, 'plain text');
  const unreadable = new ArchiveRefusal('That archive could not be read as a .tar.gz, so nothing was imported.');
  await assert.rejects(listArchive(real, path), unreadable);
  const odd = { runCommand, streamCommand: async (_e: string, _a: readonly string[], onLine: (line: string, stream: 'stdout' | 'stderr') => void) => { onLine('something else entirely', 'stdout'); return 0; } };
  await assert.rejects(listArchive(odd, path), unreadable);
});

test('GNU tar\'s listing, as the server prints it, reads the same as this machine\'s', async (t) => {
  // Captured from GNU tar 1.35 (as Ubuntu 24.04 ships), `tar -tvzf`, under LC_ALL=C (Thai escaped)
  // and C.UTF-8 (Thai as it is). GNU lists an absolute or `..` name as it is, and says on stderr
  // that it would strip it.
  const gnu = [
    'drwx------ tomecms-updater/tomecms-updater 0 2026-10-03 12:00 ./',
    '-rw------- tomecms-updater/tomecms-updater 1234 2026-10-03 12:00 ./manifest.json',
    'drwx------ tomecms-updater/tomecms-updater 0 2026-10-03 12:00 ./posts/th/',
    '-rw------- tomecms-updater/tomecms-updater   10 2026-10-03 12:00 ./posts/th/\\340\\270\\202\\340\\270\\231\\340\\270\\241\\340\\270\\233\\340\\270\\261\\340\\270\\207-\\340\\270\\242\\340\\270\\262\\340\\270\\241\\340\\270\\204\\340\\271\\210\\340\\270\\263.md',
    `-rw------- 999/999 10 2026-10-03 12:00 ./posts/th/${thai}`,
    '-rw------- root/root 5 2026-10-03 12:00 ./media/we ird\\\\name',
    'hrw------- root/root 0 2026-10-03 12:00 ./media/hard link to ./manifest.json',
    'lrwxrwxrwx root/root 0 2026-10-03 12:00 ./media/link -> /etc/shadow',
    'prw-r--r-- root/root 0 2026-10-03 12:00 ./media/fifo',
    'crw-rw-rw- root/root 1,3 2026-10-03 12:00 ./media/null',
  ];
  const fixture = { runCommand, streamCommand: async (_e: string, _a: readonly string[], onLine: (line: string, stream: 'stdout' | 'stderr') => void) => { for (const line of gnu) onLine(line, 'stdout'); return 0; } };
  const entries = await listArchive(fixture, await archiveOf(t, []));
  assert.deepEqual(entries, [
    { type: 'dir', name: './', size: 0 },
    { type: 'file', name: './manifest.json', size: 1234 },
    { type: 'dir', name: './posts/th/', size: 0 },
    { type: 'file', name: `./posts/th/${thai}`, size: 10 },
    { type: 'file', name: `./posts/th/${thai}`, size: 10 },
    { type: 'file', name: './media/we ird\\name', size: 5 },
    { type: 'other', name: './media/hard', size: 0 },
    { type: 'other', name: './media/link', size: 0 },
    { type: 'other', name: './media/fifo', size: 0 },
    { type: 'other', name: './media/null', size: 0 },
  ]);
  for (const name of ['/etc/x', '../y', 'a/../../z']) {
    const line = { runCommand, streamCommand: async (_e: string, _a: readonly string[], onLine: (line: string, stream: 'stdout' | 'stderr') => void) => { onLine(`-rw-r--r-- 0/0               1 2026-09-21 14:13 ${name}`, 'stdout'); return 0; } };
    assert.equal(refusal(await listArchive(line, await archiveOf(t, []))), `That archive holds a path outside itself (${name}), so nothing was imported.`);
  }
});

test('a Thai file name passes, and packs, lists and unpacks byte for byte', async (t) => {
  const base = await scratch(t);
  const source = join(base, 'source');
  await mkdir(join(source, 'posts', 'th'), { recursive: true });
  const body = Buffer.from('---\ntitle: ขนมปังยามค่ำ\n---\nอร่อย\n');
  await writeFile(join(source, 'manifest.json'), '{}');
  await writeFile(join(source, 'posts', 'th', thai), body);
  const packed = join(base, 'out.tar.gz');
  await packDirectory(real, source, packed);
  assert.equal((await stat(packed)).mode & 0o777, 0o600, 'the archive is never readable by others, not even for a moment');
  const entries = await listArchive(real, packed);
  assert.equal(refusal(entries), null);
  assert.ok(entries.some((entry) => entry.type === 'file' && entry.name === `./posts/th/${thai}` && entry.size === body.length), JSON.stringify(entries));
  const target = join(base, 'target');
  await mkdir(target);
  await extractArchive(real, packed, target);
  assert.deepEqual((await readdir(join(target, 'posts', 'th'))).map((name) => Buffer.from(name)), [Buffer.from(thai)]);
  assert.deepEqual(await readFile(join(target, 'posts', 'th', thai)), body);
  await assert.rejects(packDirectory(real, source, packed), { code: 'EEXIST' }, 'an archive is never written over');
});

test('a link found after unpacking is caught by the walk, whatever tar did', async (t) => {
  const target = await scratch(t);
  await mkdir(join(target, 'media'));
  await symlink('/etc/shadow', join(target, 'media', 'planted'));
  // tar itself "succeeds"; what it left behind is checked all the same.
  const quiet = { runCommand: async () => ({ code: 0, stdout: '', stderr: '' }), streamCommand };
  await assert.rejects(extractArchive(quiet, 'in.tar.gz', target),
    new ArchiveRefusal('That archive holds a link or a special file (media/planted), so nothing was imported.'));
});

test('tar runs as argv, unpacking without the archive\'s owners or permissions', async () => {
  const calls: Array<{ executable: string; args: readonly string[]; timeoutMs: number }> = [];
  const spy = { runCommand: async (executable: string, args: readonly string[], options: { timeoutMs: number }) => { calls.push({ executable, args, timeoutMs: options.timeoutMs }); return { code: 0, stdout: '', stderr: '' }; }, streamCommand };
  const target = await mkdtemp(join(tmpdir(), 'tome-archive-'));
  try {
    await extractArchive(spy, '/var/backups/tome-cms/in.tar.gz', target);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
  assert.deepEqual(calls, [{ executable: 'tar', args: ['-xzf', '/var/backups/tome-cms/in.tar.gz', '-C', target, '--no-same-owner', '--no-same-permissions'], timeoutMs: 600_000 }]);
});
