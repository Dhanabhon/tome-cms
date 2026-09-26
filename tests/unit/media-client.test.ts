import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { adminCopy } from '../../src/lib/admin-i18n';
import { MediaFileError, uploadTimeoutMs } from '../../src/lib/media';
import { bytesToBase64, MediaRequestError, stillUsedText, uploadFailureText, uploadFile, uploadImage } from '../../src/lib/media-client';

test('browser checksum encoding handles the maximum upload size without a spread overflow', () => {
  const bytes = new Uint8Array(8 * 1024 * 1024).fill(0xab);
  assert.equal(bytesToBase64(bytes), Buffer.from(bytes).toString('base64'));
});

/** A browser's PUT to the store that fails the way `outcome` says, noting the time it was given. */
function failingStorage(outcome: 'rejected' | 'timeout' | 'unreachable', seen: { timeout?: number }) {
  return class {
    onerror: (() => void) | null = null;
    onload: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    status = 0;
    timeout = 0;
    upload = { onprogress: null };
    open() {}
    setRequestHeader() {}
    send() {
      seen.timeout = this.timeout;
      queueMicrotask(() => {
        if (outcome === 'rejected') {
          this.status = 403;
          this.onload?.();
        } else if (outcome === 'timeout') this.ontimeout?.();
        else this.onerror?.();
      });
    }
  };
}

test('a PUT the store did not take says which way it failed, and was given the time its size needs', async (context) => {
  const { fetch, XMLHttpRequest } = globalThis;
  context.after(() => Object.assign(globalThis, { fetch, XMLHttpRequest }));
  globalThis.fetch = async () => Response.json({
    reservation: { expiresAt: new Date().toISOString(), headers: { 'content-type': 'application/pdf' }, id: 'reservation', uploadUrl: 'https://store.invalid/put' },
  }, { status: 201 });
  // Over the two-minute floor, so the time is read from the size and not the floor.
  const file = new File([new Uint8Array(7_000_000)], 'guide.pdf', { type: 'application/pdf' });
  for (const [outcome, code] of [['rejected', 'storage_rejected'], ['timeout', 'storage_timeout'], ['unreachable', 'storage_unreachable']] as const) {
    const seen: { timeout?: number } = {};
    globalThis.XMLHttpRequest = failingStorage(outcome, seen) as unknown as typeof globalThis.XMLHttpRequest;
    await assert.rejects(uploadFile(file), (error: unknown) => error instanceof MediaRequestError && error.code === code, outcome);
    assert.equal(seen.timeout, uploadTimeoutMs(file.size), outcome);
  }
});

test('a failed upload reads in the owner\'s language when its cause is known', () => {
  for (const locale of ['en', 'th'] as const) {
    const copy = adminCopy(locale);
    const failure = (code: string) => uploadFailureText(new MediaRequestError('English only', undefined, code), copy);
    assert.equal(failure('storage_rejected'), copy.media.storageRejected);
    assert.equal(failure('storage_timeout'), copy.media.storageTimedOut);
    assert.equal(failure('storage_unreachable'), copy.media.storageUnreachable);
    assert.equal(failure('media_macros'), copy.media.refusals.macros);
    assert.equal(failure('media_text_encoding'), copy.media.refusals.textEncoding);
    assert.equal(failure('media_type_mismatch'), copy.media.refusals.typeMismatch);
    assert.equal(uploadFailureText(new MediaFileError('imageTooLarge'), copy), copy.media.refusals.imageTooLarge);
    // Anything else keeps its own words.
    assert.equal(failure('media_unknown'), undefined);
    assert.equal(uploadFailureText(new Error('Network down'), copy), undefined);
  }
});

test('an image the editor cannot keep is refused before anything is sent, in words the admin has', async () => {
  const refused = (refusal: string) => (error: unknown) => error instanceof MediaFileError && error.refusal === refusal;
  const large = new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' });
  await assert.rejects(uploadImage(large), refused('imageTooLarge'));
  await assert.rejects(uploadImage(new File(['%PDF'], 'guide.pdf', { type: 'application/pdf' })), refused('unsupportedImage'));
  await assert.rejects(uploadImage(new File([], 'empty.png', { type: 'image/png' })), refused('empty'));
});

test('a file the library keeps is explained in the owner’s language, from the places the server named', () => {
  const references = {
    counts: { maintenance: 0, pageContent: 1, plugins: 0, postContent: 1, postCovers: 0, profile: 0, slides: 0 },
    maintenance: false, pages: [], plugins: [], posts: [], profile: false, slides: [],
  };
  const once = { ...references, counts: { ...references.counts, pageContent: 0 } };
  assert.equal(stillUsedText(references, adminCopy('en')), 'This file is still used in 2 locations.');
  assert.equal(stillUsedText(once, adminCopy('en')), 'This file is still used in 1 location.');
  assert.equal(stillUsedText(references, adminCopy('th')), 'ไฟล์นี้ยังถูกใช้อยู่ 2 แห่ง');
  assert.equal(stillUsedText(once, adminCopy('th')), 'ไฟล์นี้ยังถูกใช้อยู่ 1 แห่ง');
  const library = readFileSync(new URL('../../src/components/admin/MediaLibrary.tsx', import.meta.url), 'utf8');
  assert.match(library, /stillUsedText\(deleteFailure\.references, copy\)/, 'the library shows it, not the server’s sentence');
});
