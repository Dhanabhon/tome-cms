import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import {
  acceptAttribute,
  ACCEPTED_DOCUMENT_TYPES,
  declaredMediaType,
  documentLabel,
  documentTypeForName,
  formatBytes,
  formatLabel,
  MAX_DOCUMENT_FILE_BYTES,
  MAX_IMAGE_BYTES,
  MediaFileError,
  mediaExtension,
  typesForFilter,
  uploadTimeoutMs,
} from '../../src/lib/media';
import { createObjectKey, isTomeObjectKey } from '../../src/server/media/keys';

const OWNER = '123e4567-e89b-42d3-a456-426614174000';

/** What `declaredMediaType` says of a file: its type, or the reason it will not be sent. */
function verdict(file: { name: string; size: number; type: string }, accept?: 'any' | 'document' | 'image') {
  try {
    return declaredMediaType(file, accept);
  } catch (error) {
    return error instanceof MediaFileError ? `refused: ${error.refusal}` : 'thrown';
  }
}

test('a document is known by its name, and only the seven are known', () => {
  assert.equal(documentTypeForName('คู่มือการสมัคร.PDF'), 'application/pdf');
  assert.equal(documentTypeForName('Budget 2569.xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(documentTypeForName('notes.txt '), 'text/plain', 'a trailing space is not part of the extension');
  for (const name of ['old.doc', 'old.xls', 'old.ppt', 'macros.docm', 'macros.xlsm', 'macros.pptm', 'page.html', 'logo.svg', 'setup.exe', 'pdf', 'archive.zip.exe']) {
    assert.equal(documentTypeForName(name), null, `${name} is not a document the library keeps`);
  }
  assert.deepEqual(ACCEPTED_DOCUMENT_TYPES.map(documentLabel), ['PDF', 'DOCX', 'XLSX', 'PPTX', 'CSV', 'TXT', 'ZIP']);
  assert.equal(mediaExtension('application/zip'), 'zip');
  assert.equal(mediaExtension('image/jpeg'), 'jpg');
  assert.equal(mediaExtension('application/msword'), null);
  assert.equal(mediaExtension('toString'), null, 'nothing is found on the prototype');
  assert.equal(formatLabel('image/webp'), 'WEBP');
  assert.equal(formatLabel('text/csv'), 'CSV');
});

test('a chosen file is sent as what it is, or refused in the browser with a reason', () => {
  assert.equal(verdict({ name: 'photo.png', size: 10, type: 'image/png' }), 'image/png');
  // Browsers disagree on a CSV's type and some report none for a ZIP, so a document's name decides.
  assert.equal(verdict({ name: 'data.csv', size: 10, type: 'application/vnd.ms-excel' }), 'text/csv');
  assert.equal(verdict({ name: 'archive.zip', size: 10, type: '' }), 'application/zip');
  assert.equal(verdict({ name: 'empty.pdf', size: 0, type: 'application/pdf' }), 'refused: empty');
  assert.equal(verdict({ name: 'old.doc', size: 10, type: 'application/msword' }), 'refused: unsupported');
  assert.equal(verdict({ name: 'guide.pdf', size: 10, type: 'application/pdf' }, 'image'), 'refused: unsupportedImage');
  assert.equal(verdict({ name: 'photo.png', size: 10, type: 'image/png' }, 'document'), 'refused: unsupportedDocument');
  assert.equal(verdict({ name: 'photo.png', size: MAX_IMAGE_BYTES + 1, type: 'image/png' }), 'refused: imageTooLarge');
  assert.equal(verdict({ name: 'big.zip', size: MAX_DOCUMENT_FILE_BYTES + 1, type: 'application/zip' }), 'refused: documentTooLarge');
  assert.equal(verdict({ name: 'big.zip', size: MAX_DOCUMENT_FILE_BYTES, type: 'application/zip' }), 'application/zip', '25 MB exactly');
  assert.equal(MAX_DOCUMENT_FILE_BYTES, 26_214_400);
});

test('sizes read in B, KB or MB', () => {
  assert.equal(formatBytes(812), '812 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(86_016), '84 KB');
  assert.equal(formatBytes(1_258_291), '1.2 MB');
  assert.equal(formatBytes(26_214_400), '25 MB');
});

test('a filter admits its group, and an input takes what its picker takes', () => {
  assert.deepEqual(typesForFilter('document'), ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain']);
  assert.deepEqual(typesForFilter('spreadsheet'), ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv']);
  assert.deepEqual(typesForFilter('slides'), ['application/vnd.openxmlformats-officedocument.presentationml.presentation']);
  assert.deepEqual(typesForFilter('file'), [...ACCEPTED_DOCUMENT_TYPES]);
  assert.ok(typesForFilter('image').every((type) => type.startsWith('image/')));
  assert.doesNotMatch(acceptAttribute('image'), /pdf|zip/);
  assert.match(acceptAttribute('document'), /(^|,)\.csv(,|$)/);
  assert.doesNotMatch(acceptAttribute('document'), /image\//);
  assert.match(acceptAttribute('any'), /image\/png.*\.pdf/);
});

test('the upload timeout is two minutes, or 50 KB a second when that is longer', () => {
  assert.equal(uploadTimeoutMs(1), 120_000);
  assert.equal(uploadTimeoutMs(6_000_000), 120_000);
  assert.equal(uploadTimeoutMs(MAX_DOCUMENT_FILE_BYTES), 524_288);
});

test('a document lives under the grammar backup, restore and reset accept', () => {
  const key = createObjectKey(OWNER, 'application/pdf', new Date('2026-09-22T00:00:00Z'));
  assert.match(key, /^owners\/123e4567-e89b-42d3-a456-426614174000\/2026\/09\/[0-9a-f-]{36}\.pdf$/);
  assert.equal(isTomeObjectKey(key), true);
  for (const extension of ['csv', 'docx', 'pdf', 'pptx', 'txt', 'xlsx', 'zip']) {
    assert.equal(isTomeObjectKey(`owners/${OWNER}/2026/09/${randomUUID()}.${extension}`), true, extension);
  }
  for (const extension of ['doc', 'docm', 'xlsm', 'exe', 'html']) {
    assert.equal(isTomeObjectKey(`owners/${OWNER}/2026/09/${randomUUID()}.${extension}`), false, extension);
  }
});
