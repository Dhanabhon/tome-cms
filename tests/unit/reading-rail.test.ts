import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import { publicCopy } from '../../src/lib/i18n';
import { PAGE_IDS, RAIL_MAX_HEADINGS, readingRail } from '../../src/lib/reading-rail';
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
  assert.match(ARTICLE, /readingRail\(demotedHtml\)/, 'the rail is drawn from the body with its h1s demoted');
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
  // Worked out from where the headings are, not from the order entries arrive in.
  assert.match(script, /getBoundingClientRect\(\)\.top <= window\.innerHeight \* 0\.4/);
  assert.match(script, /if \(atEnd\) current = targets\.length - 1/);
  assert.match(ARTICLE, /data-rail-end/);
});

test('the rail is a column of 2px ticks at the inline end, hidden where there is no room', () => {
  assert.match(ruleBody(PAPER, '.reading-rail'), /position: fixed/);
  assert.match(ruleBody(PAPER, '.reading-rail'), /inset-inline-end:/);
  assert.match(ruleBody(PAPER, '.reading-rail__link::before'), /block-size: 2px/);
  assert.match(ruleBody(PAPER, '.reading-rail__link--h2::before'), /inline-size: 1\.5rem/);
  assert.match(ruleBody(PAPER, '.reading-rail__link--h3::before'), /inline-size: 1rem/);
  assert.match(ruleBody(PAPER, '.reading-rail__link::before'), /background: var\(--color-muted\)/, 'a resting tick is a mark that can be seen');
  assert.match(ruleBody(PAPER, '.reading-rail__link[data-passed]::before'), /background: var\(--color-ink\)/, 'a heading already read is ink');
  assert.match(ruleBody(PAPER, '.reading-rail__link[aria-current="location"]::before'), /background: var\(--color-accent\)/, 'the current one is the accent');
  assert.match(ruleBody(PAPER, '.reading-rail__link[aria-current="location"]::before'), /block-size: 3px/);
  assert.match(ARTICLE, /toggleAttribute\('data-passed', at < index\)/);
  assert.match(ruleBody(PAPER, '.reading-rail__link'), /min-block-size: 1\.5rem/);
  assert.match(PAPER, /@media \(pointer: coarse\) \{[^}]*\.reading-rail__link \{[^}]*min-block-size: 2\.75rem/);
  assert.match(PAPER, /@media \(max-width: 63\.999rem\) \{[^}]*\.reading-rail \{ display: none; \}/);
  assert.match(PAPER, /@media \(min-width: 64rem\) \{[^}]*\.reading-progress\[data-rail\] \{ display: none; \}/);
  assert.match(ruleBody(PAPER, '.reading-rail__link:is(:hover, :focus-visible)::before'), /background: var\(--color-ink\)/);
  assert.match(PAPER, /\.reading-rail__link:is\(:hover, :focus-visible\) \.reading-rail__label/);
  assert.match(PAPER, /@media \(prefers-reduced-motion: no-preference\) \{[^@]*html:has\(\.reading-rail\) \{ scroll-behavior: smooth; \}/);
  assert.match(PAPER, /\.post-body :is\(h2, h3\) \{ scroll-margin-block-start:/);
});

test('an empty heading is not in the rail, and does not count toward the two it needs', () => {
  const only = '<h2></h2><h2>A</h2><p>x</p>';
  assert.deepEqual(readingRail(only), { headings: [], html: only });
  const { headings, html } = readingRail('<h2></h2><h2>A</h2><h3>B</h3>');
  assert.deepEqual(headings.map(({ text }) => text), ['A', 'B']);
  assert.match(html, /^<h2><\/h2><h2 id="a">/, 'the empty one is left as it was');
});

test('a line break inside a heading is a space, not nothing', () => {
  const { headings } = readingRail('<h2>First<br />line<br>two</h2><h2>B</h2>');
  assert.equal(headings[0].text, 'First line two');
  assert.equal(headings[0].id, 'first-line-two');
});

test('a numeric entity out of range does not stop the page', () => {
  const { headings } = readingRail('<h2>Odd &#99999999; &#xFFFFFFFF; end</h2><h2>B</h2>');
  assert.match(headings[0].text, /^Odd .* end$/u);
});

test('a heading never takes an id the page already uses outside the body', () => {
  const { headings, html } = readingRail('<h2>Language switcher menu</h2><h2>Site popup heading</h2>');
  assert.deepEqual(headings.map(({ id }) => id), ['language-switcher-menu-2', 'site-popup-heading-2']);
  assert.doesNotMatch(html, /id="language-switcher-menu"/);
});

test('the ids a Paper page uses outside the body are all on the list', () => {
  // Every literal id in what a Paper post page is made of: the layout, the shared components and
  // the theme. A new one that is not in PAGE_IDS could be taken by a heading, and two elements
  // would answer to it.
  const files = ['src/layouts', 'src/components', 'src/themes/paper'].flatMap((directory) =>
    readdirSync(new URL(`../../${directory}/`, import.meta.url), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.astro') && !entry.parentPath.includes('/admin'))
      .map((entry) => `${entry.parentPath}/${entry.name}`));
  assert.ok(files.length > 10);
  const found = new Set<string>();
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const [, id] of source.matchAll(/\sid="([^"{]+)"/g)) found.add(id);
    // A toggle's panel is named from the toggle: `${name}-panel`.
    for (const [, name] of source.matchAll(/<ThemeToggle[^>]*\sname="([^"]+)"/g)) found.add(`${name}-panel`);
  }
  assert.ok(found.has('language-switcher-menu') && found.has('tome-theme-site-panel'), 'the scan finds what it should');
  for (const id of found) assert.ok(PAGE_IDS.includes(id), `${id} is used by the page and is not in PAGE_IDS`);
});

test('a post with more headings than a column of ticks can hold gets the bar, not a rail that runs off the window', () => {
  const many = (count: number) => Array.from({ length: count }, (_, n) => `<h2>Part ${n}</h2>`).join('');
  assert.equal(readingRail(many(RAIL_MAX_HEADINGS)).headings.length, RAIL_MAX_HEADINGS);
  assert.deepEqual(readingRail(many(RAIL_MAX_HEADINGS + 1)), { headings: [], html: many(RAIL_MAX_HEADINGS + 1) });
  // Sixteen 44px targets still fit a landscape tablet.
  assert.ok(RAIL_MAX_HEADINGS * 44 <= 768);
});
