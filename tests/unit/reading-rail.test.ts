import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { publicCopy } from '../../src/lib/i18n';
import { readingRail } from '../../src/lib/reading-rail';
import { manifest } from '../../src/themes/paper/theme';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const PAPER = read('src/themes/paper/theme.css');
const ARTICLE = read('src/themes/paper/parts/PostArticle.astro');

/** The declarations of the first unindented rule whose selector list is exactly `selector`. */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(match, `no rule for ${selector}`);
  return match[1];
}

test('the reading position keeps what is stored valid and adds the rail', () => {
  const setting = manifest.settings?.find(({ key }) => key === 'readingProgress');
  assert.ok(setting);
  assert.equal(setting.kind, 'choice');
  // The store accepts exactly a choice's option values, so a stored on or off stays a value.
  assert.deepEqual(setting.options?.map(({ value }) => value), ['off', 'on', 'rail']);
  assert.equal(setting.fallback, 'off');
  assert.equal(setting.label.en, 'Reading position');
  assert.deepEqual(setting.options?.map(({ label }) => label.en), ['Off', 'Bar at the top', 'Rail at the side']);
  assert.deepEqual(setting.options?.map(({ label }) => label.th), ['ปิด', 'แถบด้านบน', 'รางด้านข้าง']);
});

test('headings get an id, Thai letters kept, and a repeat is numbered', () => {
  const { headings, html } = readingRail('<h2>Why we wrote it</h2><p>x</p><h3>Why we wrote it</h3><h2>ทำไมเราถึงเขียน</h2><h3>Why we wrote it</h3>');
  assert.deepEqual(headings.map(({ id }) => id), ['why-we-wrote-it', 'why-we-wrote-it-2', headings[2].id, 'why-we-wrote-it-3']);
  assert.match(headings[2].id, /^\p{Script=Thai}+(?:-\p{Script=Thai}+)*$/u, 'the Thai heading has a Thai anchor');
  assert.deepEqual(headings.map(({ level }) => level), [2, 3, 2, 3]);
  assert.match(html, /<h2 id="why-we-wrote-it">Why we wrote it<\/h2>/);
  assert.match(html, /<h3 id="why-we-wrote-it-3">/);
});

test('a heading that has an id keeps it, and no other heading takes it', () => {
  const { headings, html } = readingRail('<h2>Intro</h2><h2 id="intro">Intro again</h2><h3 style="text-align: center">Centred</h3>');
  assert.deepEqual(headings.map(({ id }) => id), ['intro-2', 'intro', 'centred']);
  assert.match(html, /<h2 id="intro">Intro again<\/h2>/);
  assert.match(html, /<h3 id="centred" style="text-align: center">Centred<\/h3>/, 'the other attributes are not disturbed');
});

test("a heading's text is what a reader sees: marks dropped, entities decoded", () => {
  const { headings } = readingRail('<h2>Tom &amp; <em>Jerry</em> <span class="tome-color-red">&lt;3</span></h2><h3>Two</h3>');
  assert.equal(headings[0].text, 'Tom & Jerry <3');
  assert.equal(headings[0].id, 'tom-jerry-3');
});

test('a heading with nothing to name it still gets an anchor', () => {
  const { headings } = readingRail('<h2>???</h2><h2>!!!</h2>');
  assert.deepEqual(headings.map(({ id }) => id), ['section', 'section-2']);
});

test('the rail is only for a body with at least two headings; h1 and other tags do not count', () => {
  const one = '<h2>Only one</h2><p>text</p>';
  assert.deepEqual(readingRail(one), { headings: [], html: one });
  const flat = '<h1>Title</h1><p>text</p><h1>Title</h1>';
  assert.deepEqual(readingRail(flat), { headings: [], html: flat });
  assert.equal(readingRail('<h2>One</h2><h3>Two</h3>').headings.length, 2);
});

test('the rail ignores a section break', () => {
  const { headings, html } = readingRail('<h2>One</h2><hr><h2>Two</h2>');
  assert.equal(headings.length, 2);
  assert.match(html, /<hr>/);
});

test('the article draws the rail from those headings, in the reader\'s language, only when it has them', () => {
  assert.match(ARTICLE, /readingRail\(coverHtml\)/);
  assert.match(ARTICLE, /headings\.length > 0 && \(/);
  assert.match(ARTICLE, /<nav class="reading-rail" aria-label=\{copy\.onThisPage\} data-reading-rail>/);
  assert.match(ARTICLE, /<a href=\{`#\$\{id\}`\} class=\{`reading-rail__link reading-rail__link--h\$\{level\}`\}>/);
  assert.equal(publicCopy('en').onThisPage, 'On this page');
  assert.equal(publicCopy('th').onThisPage, 'ในหน้านี้');
});

test('the current section comes from one IntersectionObserver, not a scroll listener', () => {
  const script = /<script>([\s\S]*?)<\/script>/.exec(ARTICLE)?.[1] ?? '';
  assert.match(script, /new IntersectionObserver\(/);
  assert.match(script, /aria-current/);
  assert.doesNotMatch(script, /addEventListener\(\s*'scroll'/);
});

test('the rail is a column of 2px ticks at the inline end, hidden where there is no room', () => {
  assert.match(ruleBody(PAPER, '.reading-rail'), /position: fixed/);
  assert.match(ruleBody(PAPER, '.reading-rail'), /inset-inline-end:/);
  assert.match(ruleBody(PAPER, '.reading-rail__link::before'), /block-size: 2px/);
  assert.match(ruleBody(PAPER, '.reading-rail__link--h2::before'), /inline-size: 1\.5rem/);
  assert.match(ruleBody(PAPER, '.reading-rail__link--h3::before'), /inline-size: 1rem/);
  assert.match(ruleBody(PAPER, '.reading-rail__link::before'), /background: var\(--color-rule\)/);
  assert.match(ruleBody(PAPER, '.reading-rail__link[aria-current="location"]::before'), /background: var\(--color-ink\)/);
  assert.match(ruleBody(PAPER, '.reading-rail__link'), /min-block-size: 1\.5rem/);
  assert.match(PAPER, /@media \(pointer: coarse\) \{[^}]*\.reading-rail__link \{[^}]*min-block-size: 2\.75rem/);
  assert.match(PAPER, /@media \(max-width: 63\.999rem\) \{[^}]*\.reading-rail \{ display: none; \}/);
  assert.match(PAPER, /@media \(min-width: 64rem\) \{[^}]*\.reading-progress\[data-rail\] \{ display: none; \}/);
  assert.match(PAPER, /\.reading-rail__link:is\(:hover, :focus-visible\) \.reading-rail__label/);
  assert.match(PAPER, /@media \(prefers-reduced-motion: no-preference\) \{[^@]*html:has\(\.reading-rail\) \{ scroll-behavior: smooth; \}/);
  assert.match(PAPER, /\.post-body :is\(h2, h3\) \{ scroll-margin-block-start:/);
});
