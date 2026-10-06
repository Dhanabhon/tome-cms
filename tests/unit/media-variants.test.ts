import assert from 'node:assert/strict';
import test from 'node:test';

import sharp from 'sharp';

import { inspectImage, makeVariants, variantWidth } from '../../src/server/media/image';

const jpeg = (width: number, height: number) =>
  sharp({ create: { background: '#2e7d5b', channels: 3, height, width } }).jpeg().toBuffer();

test('only the widths narrower than the original are made, as WebP', async () => {
  const widths = async (width: number) => (await makeVariants(await jpeg(width, 100))).map((variant) => variant.width);
  assert.deepEqual(await widths(400), []);
  assert.deepEqual(await widths(480), []);
  assert.deepEqual(await widths(1000), [480, 960]);
  assert.deepEqual(await widths(2000), [480, 960, 1600]);
  assert.deepEqual(await widths(4000), [480, 960, 1600]);

  for (const variant of await makeVariants(await jpeg(2000, 1000))) {
    const metadata = await sharp(variant.body).metadata();
    assert.equal(metadata.format, 'webp');
    assert.deepEqual([metadata.width, metadata.height], [variant.width, variant.width / 2]);
  }
});

test('an animated image gets no smaller copies', async () => {
  // Two different 1200-wide frames (identical ones are folded into one).
  const frame = (background: string) => sharp({ create: { background, channels: 4, height: 1200, width: 1200 } }).png().toBuffer();
  const gif = await sharp([await frame('#fff'), await frame('#c33')], { join: { animated: true } }).gif({ loop: 0 }).toBuffer();
  assert.equal((await sharp(gif, { animated: true }).metadata()).pages, 2);
  assert.deepEqual(await makeVariants(gif), []);
});

test('a copy is turned the way the photo was taken and keeps none of its metadata', async () => {
  // Stored 2000 wide and 1000 high, but taken upright: EXIF orientation 6 turns it 90°.
  const photo = await sharp({ create: { background: '#c33', channels: 3, height: 1000, width: 2000 } })
    .jpeg().withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'Someone', Make: 'Phone' } } }).toBuffer();
  assert.ok((await sharp(photo).metadata()).exif);
  const variants = await makeVariants(photo);
  assert.deepEqual(variants.map((variant) => variant.width), [480, 960]);
  for (const variant of variants) {
    const metadata = await sharp(variant.body).metadata();
    assert.deepEqual([metadata.width, metadata.height], [variant.width, variant.width * 2]);
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.orientation, undefined);
  }
});

test('a photo taken on its side is measured the way it is seen', async () => {
  // Stored 2000 wide and 1000 high; EXIF orientation 6 shows it 1000 wide and 2000 high.
  const photo = await sharp({ create: { background: '#c33', channels: 3, height: 1000, width: 2000 } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
  assert.deepEqual(await inspectImage(photo, 'image/jpeg'), { height: 2000, width: 1000 });
  assert.deepEqual(await inspectImage(await jpeg(2000, 1000), 'image/jpeg'), { height: 1000, width: 2000 });
});

test('/media asks for a copy only by one of its exact widths', () => {
  assert.equal(variantWidth('480'), 480);
  assert.equal(variantWidth('960'), 960);
  assert.equal(variantWidth('1600'), 1600);
  for (const other of [null, '', '0', '481', '0480', '480.0', ' 480', '480px', '2000', '1e3', 'w']) {
    assert.equal(variantWidth(other), null, String(other));
  }
});
