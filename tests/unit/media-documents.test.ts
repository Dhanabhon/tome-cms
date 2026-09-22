import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';

import type { SupportedDocumentType } from '../../src/lib/media';
import { contentDisposition } from '../../src/server/media/disposition';
import { centralDirectoryNames, documentRefusal, findCentralDirectory, readDocument } from '../../src/server/media/document';
import { office, zip } from '../helpers/zip';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as const;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' as const;
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation' as const;

/** Streams `bytes` in pieces of `size`, so a check that only works on a whole file fails. */
function pieces(bytes: Buffer, size = 7): Readable {
  const parts: Buffer[] = [];
  for (let at = 0; at < bytes.length; at += size) parts.push(bytes.subarray(at, at + size));
  return Readable.from(parts);
}

/** What the service does: one read of the whole file, then ranges answered from it. */
async function judge(type: SupportedDocumentType, bytes: Buffer) {
  const read = await readDocument(pieces(bytes), bytes.length, type === 'text/csv' || type === 'text/plain');
  assert.ok(read);
  const ranges: Array<[number, number]> = [];
  const refusal = await documentRefusal(type, read, async (start, end) => {
    ranges.push([start, end]);
    return bytes.subarray(start, end + 1);
  });
  return { ranges, refusal };
}

test('one read hashes a document and keeps only its first kilobyte', async () => {
  const bytes = Buffer.alloc(300_000, 0x61);
  const read = await readDocument(pieces(bytes, 4096), bytes.length, true);
  assert.equal(read?.checksum, createHash('sha256').update(bytes).digest('base64'));
  assert.equal(read?.size, 300_000);
  assert.equal(read?.head.length, 1024);
  assert.equal(await readDocument(pieces(bytes), bytes.length - 1, false), null, 'a file longer than declared stops the read');
});

test('text is UTF-8 without a zero byte, wherever the store cuts it', async () => {
  // Seven-byte pieces cut Thai letters, three bytes each, across reads.
  const thai = Buffer.from('ชื่อ,อายุ\nสมชาย,30\n', 'utf8');
  assert.equal((await judge('text/csv', thai)).refusal, null);
  assert.equal((await judge('text/csv', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), thai]))).refusal, null, 'a byte-order mark');
  // What Excel's plain "CSV" writes on a Thai system: Windows-874, one byte a letter.
  assert.equal((await judge('text/csv', Buffer.from([0xaa, 0xd7, 0xe8, 0xcd, 0x2c, 0x31, 0x0a]))).refusal, 'media_text_encoding');
  assert.equal((await judge('text/plain', Buffer.from([0x61, 0x00, 0x62]))).refusal, 'media_text_encoding', 'a zero byte');
  assert.equal((await judge('text/plain', Buffer.from([0x61, 0xe0, 0xb8]))).refusal, 'media_text_encoding', 'a letter cut off at the end');
});

test('a PDF starts as one', async () => {
  assert.equal((await judge('application/pdf', Buffer.from('%PDF-1.7\n%%EOF\n'))).refusal, null);
  assert.equal((await judge('application/pdf', office('word/document.xml'))).refusal, 'media_type_mismatch');
});

test('an Office file is its type and carries no macro project, and only its end is fetched again', async () => {
  assert.equal((await judge(DOCX, office('word/document.xml'))).refusal, null);
  assert.equal((await judge(XLSX, office('xl/workbook.xml'))).refusal, null);
  assert.equal((await judge(PPTX, office('ppt/presentation.xml'))).refusal, null);
  assert.equal((await judge(DOCX, office('xl/workbook.xml'))).refusal, 'media_type_mismatch', 'a workbook named .docx');
  assert.equal((await judge(DOCX, office('word/document.xml', [{ data: 'x', name: 'word/vbaProject.bin' }]))).refusal,
    'media_macros', 'a .docm renamed');
  assert.equal((await judge(XLSX, office('xl/workbook.xml', [{ data: 'x', name: 'xl/VBAPROJECT.BIN' }]))).refusal, 'media_macros');
  assert.equal((await judge(DOCX, Buffer.from('%PDF-1.7\n'))).refusal, 'media_type_mismatch');
  const docx = office('word/document.xml');
  assert.equal((await judge(DOCX, docx.subarray(0, docx.length - 10))).refusal, 'media_type_mismatch', 'an archive cut short');

  const large = office('word/document.xml', [{ data: Buffer.alloc(200_000, 1), name: 'word/media/photo.bin' }]);
  const { ranges, refusal } = await judge(DOCX, large);
  assert.equal(refusal, null);
  assert.deepEqual(ranges[0], [large.length - 65_557, large.length - 1], 'the end, and only the end');
  assert.ok(ranges.every(([start, end]) => end - start < 70_000), 'never the whole file');
});

test('a ZIP is one to its end, and an empty one is still one', async () => {
  assert.equal((await judge('application/zip', zip([{ data: 'a', name: 'a.txt' }], 'a comment at the end'))).refusal, null);
  const empty = zip([]);
  assert.equal(empty.length, 22);
  assert.equal((await judge('application/zip', empty)).refusal, null);
  assert.equal((await judge('application/zip', Buffer.from('PK not really'))).refusal, 'media_type_mismatch');
});

test('a directory is read only where it says it is', () => {
  const archive = zip([{ data: '1', name: 'one.txt' }, { data: '2', name: 'สอง.txt' }]);
  const directory = findCentralDirectory(archive.subarray(-65_557), archive.length);
  assert.ok(directory);
  assert.equal(directory.entries, 2);
  assert.deepEqual(centralDirectoryNames(archive.subarray(directory.offset, directory.offset + directory.size), directory.entries),
    ['one.txt', 'สอง.txt']);
  // An end record that points past itself is not one.
  const lying = Buffer.from(archive);
  lying.writeUInt32LE(archive.length, archive.length - 6);
  assert.equal(findCentralDirectory(lying.subarray(-65_557), lying.length), null);
  assert.equal(centralDirectoryNames(Buffer.from('not a directory at all, not even close to one'), 1), null);
});

test('a document keeps its own name, and a PDF opens where it is', () => {
  assert.equal(contentDisposition('คู่มือการสมัคร.pdf', 'application/pdf'),
    `inline; filename="file.pdf"; filename*=UTF-8''${encodeURIComponent('คู่มือการสมัคร.pdf')}`);
  assert.equal(contentDisposition('Budget 2026.xlsx', XLSX), `attachment; filename="Budget 2026.xlsx"; filename*=UTF-8''Budget%202026.xlsx`);
  // RFC 5987 has no room for these unescaped.
  assert.equal(contentDisposition(`Tom's (final) *copy*.docx`, DOCX),
    `attachment; filename="Tom's (final) *copy*.docx"; filename*=UTF-8''Tom%27s%20%28final%29%20%2Acopy%2A.docx`);
  // A quote would end the plain name early.
  assert.equal(contentDisposition('say "hi".txt', 'text/plain'), `attachment; filename="file.txt"; filename*=UTF-8''say%20%22hi%22.txt`);
});
