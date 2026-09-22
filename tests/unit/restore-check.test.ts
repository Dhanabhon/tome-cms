import assert from 'node:assert/strict';
import test from 'node:test';

import { documentDispositions } from '../../scripts/restore-check';
import { contentDisposition } from '../../src/server/media/disposition';
import { createObjectKey } from '../../src/server/media/keys';

const OWNER = '123e4567-e89b-42d3-a456-426614174000';
const DATE = new Date('2026-09-22T00:00:00Z');
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as const;

test('documentDispositions maps a ready document row to the header a restore puts back', () => {
  const pdfKey = createObjectKey(OWNER, 'application/pdf', DATE);
  const docxKey = createObjectKey(OWNER, DOCX, DATE);
  const thaiName = 'แผนงาน.docx';
  const dispositions = documentDispositions([
    { key: pdfKey, name: 'guide.pdf', type: 'application/pdf' },
    { key: docxKey, name: thaiName, type: DOCX },
  ]);
  assert.equal(dispositions.get(pdfKey), 'inline; filename="guide.pdf"; filename*=UTF-8\'\'guide.pdf');
  assert.equal(dispositions.get(docxKey), contentDisposition(thaiName, DOCX));
});

test('documentDispositions throws on anything that is not a ready document row', () => {
  const key = createObjectKey(OWNER, 'application/pdf', DATE);
  assert.throws(() => documentDispositions([{ key, name: 'photo.png', type: 'image/png' }]), /Restored media rows are invalid/, 'an image row');
  assert.throws(() => documentDispositions([{ key: 'not-a-real-key', name: 'guide.pdf', type: 'application/pdf' }]), /Restored media rows are invalid/, 'a bad key');
  assert.throws(() => documentDispositions([{ key, name: '', type: 'application/pdf' }]), /Restored media rows are invalid/, 'an empty name');
  assert.throws(() => documentDispositions('not-an-array'), /Restored media rows are invalid/, 'a non-array');
});
