import assert from 'node:assert/strict';
import test from 'node:test';

import sharp from 'sharp';

import { insideOnlyCss, sanitizeSvg } from '../../src/server/media/svg';

// Everything a hostile or careless file carries, beside a real logo's shapes.
const HOSTILE = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:sodipodi="http://sodipodi.sourceforge.net" viewBox="0 0 120 40" onload="alert(1)">
<sodipodi:namedview id="n"/><metadata><rdf>kept out</rdf></metadata>
<script><![CDATA[alert(2)]]></script>
<foreignObject><div>leaked</div></foreignObject>
<a href="javascript:alert(3)"><rect width="10" height="10"/></a>
<image href="https://evil.test/t.png"/>
<use xlink:href="https://evil.test/sprite.svg#i"/>
<defs><linearGradient id="g"><stop offset="0" stop-color="#123"/></linearGradient><clipPath id="c"><rect width="5" height="5"/></clipPath></defs>
<use href="#g"/>
<style><![CDATA[@import url('https://evil.test/x.css'); .a{fill:url(#g)} .b{fill:url("https://evil.test/p.png")}]]></style>
<path d="M0 0L10 10" style="fill:#2e7d5b;background:url(https://evil.test/q.png)" onclick="alert(4)"/>
<text x="4" y="30">Tome &amp; co</text>
</svg>`;

test('nothing that runs survives', () => {
  const clean = sanitizeSvg(HOSTILE);
  for (const gone of ['<script', 'alert(', 'onload', 'onclick', 'foreignObject', 'leaked', 'javascript:', '<a ', '<image', 'sodipodi', 'kept out']) {
    assert.ok(!clean.includes(gone), `${gone} survived`);
  }
});

test('nothing reaches outside the file', () => {
  const clean = sanitizeSvg(HOSTILE);
  assert.ok(!clean.includes('evil.test'), 'an outside address survived');
  assert.ok(clean.includes('href="#g"'), 'a reference inside the file was lost');
  assert.ok(clean.includes('url(#g)'), 'a gradient fill was lost');
});

test('what a logo is drawn with keeps its shape and its case', () => {
  const clean = sanitizeSvg(HOSTILE);
  for (const kept of ['viewBox="0 0 120 40"', '<linearGradient', '<clipPath', 'stop-color="#123"', 'd="M0 0L10 10"', 'fill:#2e7d5b', 'Tome &amp; co']) {
    assert.ok(clean.includes(kept), `${kept} was lost`);
  }
  assert.match(clean, /^<svg[\s>]/, 'the drawing is still the root');
});

test('CSS with an escape in it is not read at all', () => {
  // An escape can spell url( without its letters; a logo has no use for one.
  assert.equal(insideOnlyCss('.a{background:\\75 rl(https://evil.test/)}'), '');
  assert.equal(insideOnlyCss('.a{background-image:image-set("https://evil.test/a.png" 1x)}'), '');
  assert.equal(insideOnlyCss('.a{fill:url( #g )}'), '.a{fill:url( #g )}');
  assert.equal(insideOnlyCss(".a{fill:url('#g')}"), ".a{fill:url('#g')}");
});

test('what is left can still be drawn', async () => {
  const metadata = await sharp(Buffer.from(sanitizeSvg(HOSTILE))).metadata();
  assert.deepEqual([metadata.format, metadata.width, metadata.height], ['svg', 120, 40]);
});
