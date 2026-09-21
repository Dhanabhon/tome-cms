import assert from 'node:assert/strict';
import test from 'node:test';

import sharp from 'sharp';

import { HttpError } from '../../src/server/http/errors';
import { MAX_BRAND_BYTES, prepareBrandImage } from '../../src/server/media/brand-image';

const png = (width: number, height: number) =>
  sharp({ create: { background: '#2e7d5b', channels: 4, height, width } }).png().toBuffer();
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><script>alert(1)</script><circle cx="12" cy="12" r="10" fill="#2e7d5b"/></svg>');

async function refused(pending: Promise<unknown>, status: number, code: string) {
  await assert.rejects(pending, (error: unknown) =>
    error instanceof HttpError && error.status === status && error.details?.code === code);
}

test('a raster logo is stored as it came, with its size read', async () => {
  const bytes = await png(400, 100);
  const prepared = await prepareBrandImage('logo', bytes);
  if (prepared.kind === 'icon') throw new Error('a logo');
  assert.deepEqual([prepared.width, prepared.height, prepared.mime, prepared.source.extension], [400, 100, 'image/png', 'png']);
  assert.ok(prepared.source.body.equals(bytes), 'not resized and not re-encoded');
});

test('an SVG logo is kept only as made safe', async () => {
  const prepared = await prepareBrandImage('logo-dark', SVG);
  if (prepared.kind === 'icon') throw new Error('a logo');
  assert.equal(prepared.mime, 'image/svg+xml');
  assert.equal(prepared.source.contentType, 'image/svg+xml');
  assert.ok(!prepared.source.body.toString('utf8').includes('script'));
  assert.deepEqual([prepared.width, prepared.height], [24, 24]);
});

test('the type is read from the bytes, and each kind takes its own', async () => {
  await refused(prepareBrandImage('logo', Buffer.from('GIF89a\x01\x00\x01\x00')), 415, 'brand_type');
  await refused(prepareBrandImage('logo', Buffer.from('not an image at all')), 415, 'brand_type');
  const jpeg = await sharp({ create: { background: '#fff', channels: 3, height: 512, width: 512 } }).jpeg().toBuffer();
  await refused(prepareBrandImage('icon', jpeg), 415, 'brand_type');
});

test('an icon is drawn at the two sizes a tab and a phone ask for, square', async () => {
  const prepared = await prepareBrandImage('icon', await png(600, 300));
  if (prepared.kind !== 'icon') throw new Error('an icon');
  assert.equal(prepared.svg, null);
  for (const [file, size] of [[prepared.png32, 32], [prepared.png180, 180]] as const) {
    const metadata = await sharp(file.body).metadata();
    assert.deepEqual([metadata.format, metadata.width, metadata.height, file.contentType], ['png', size, size, 'image/png']);
  }
  // Centred on a transparent square, not cropped to fill it: a wide icon leaves the corners empty.
  const { data } = await sharp(prepared.png180.body).raw().toBuffer({ resolveWithObject: true });
  assert.equal(data[3], 0, 'the top-left corner is transparent');
});

test('an SVG icon is kept for the browsers that take one', async () => {
  const prepared = await prepareBrandImage('icon', SVG);
  if (prepared.kind !== 'icon') throw new Error('an icon');
  assert.ok(prepared.svg && !prepared.svg.body.toString('utf8').includes('script'));
  assert.equal((await sharp(prepared.png180.body).metadata()).width, 180);
});

test('what cannot be used is refused, and says why', async () => {
  await refused(prepareBrandImage('icon', await png(120, 120)), 400, 'brand_icon_small');
  await refused(prepareBrandImage('logo', Buffer.alloc(MAX_BRAND_BYTES + 1)), 413, 'brand_too_large');
  await refused(prepareBrandImage('logo', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"></svg>')), 400, 'brand_svg_unusable');
});
