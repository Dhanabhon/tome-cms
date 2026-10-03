import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * Paper as paper (1.14.0, D2): a cream page with hairline rules rather than rounded bordered cards,
 * Google Sans for every word, and a tinted ink in the dark. Read from the stylesheet and the
 * templates, the way the 1.12.1 surface tests are; the e2e in home-search.spec.ts sees the page.
 */
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const CSS = read('src/themes/paper/theme.css').replace(/\/\*[\s\S]*?\*\//g, '');
const TOKENS = read('src/styles/installer-tokens.css');
const HOME = read('src/themes/paper/Home.astro');

// A Paper page, or the admin's draft preview of a Paper article, which has no Paper body.
const LIGHT = ':root:has(> body.paper, .post-page) {';
const DARK_SYSTEM = ":root:not([data-theme='light']):has(> body.paper, .post-page) {";
const DARK_CHOSEN = ":root[data-theme='dark']:has(> body.paper, .post-page) {";

/** Every rule as [the selectors and at-rules it sits in, its own selector, its declarations]. */
function rules(css: string): Array<{ context: string[]; selector: string; body: string }> {
  const found: Array<{ context: string[]; selector: string; body: string }> = [];
  const stack: string[] = [];
  let prelude = '';
  for (let at = 0; at < css.length; at += 1) {
    const char = css[at];
    if (char === '{') {
      const selector = prelude.trim();
      const close = css.indexOf('}', at);
      const nextOpen = css.indexOf('{', at + 1);
      // A block with no block inside it is a rule; anything else is a context to descend into.
      if (!selector.startsWith('@') && (nextOpen === -1 || nextOpen > close)) {
        found.push({ context: [...stack], selector, body: css.slice(at + 1, close) });
        at = close;
      } else {
        stack.push(selector);
      }
      prelude = '';
    } else if (char === '}') {
      stack.pop();
      prelude = '';
    } else if (char === ';' && !stack.length) {
      prelude = '';
    } else {
      prelude += char;
    }
  }
  return found;
}

const RULES = rules(CSS);
/** The declarations of `selector` inside the at-rule written exactly as `at`. */
const within = (at: string, selector: string) => RULES.find((rule) => rule.selector === selector && rule.context.includes(at))?.body ?? '';
const WIDE = '@media (min-width: 48rem)';
/** Where a slide's words go over its picture. */
const SLIDES_OVER = '@media (min-width: 64rem)';
const body = (selector: string) => {
  const rule = RULES.find((candidate) => candidate.selector === selector && !candidate.context.length);
  assert.ok(rule, `no top-level rule for ${selector}`);
  return rule.body;
};

test("Paper's page is the cream every theme's html already has, not a white repaint", () => {
  for (const { selector, body: declarations } of RULES) {
    if (!/(^|[\s,(>])(html|body)\b/.test(selector) || !/background/.test(declarations)) continue;
    assert.match(declarations, /background: var\(--color-paper-2\)/, `${selector} paints the page something else`);
  }
  // The home's opening band is the page too, not a white panel on it.
  assert.doesNotMatch(body('.home-hero'), /background/);
});

type Rgb = readonly [number, number, number];
function oklch(value: string): Rgb {
  const match = /^oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)$/.exec(value.trim());
  assert.ok(match, `${value} is not a literal oklch()`);
  const [lightness, chroma, hue] = [Number(match[1]) / 100, Number(match[2]), (Number(match[3]) * Math.PI) / 180];
  const [a, b] = [chroma * Math.cos(hue), chroma * Math.sin(hue)];
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((linear) => Math.min(1, Math.max(0, linear))) as unknown as Rgb;
}
const luminance = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const contrast = (one: Rgb, two: Rgb) => {
  const [high, low] = [luminance(one), luminance(two)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};
const token = (css: string, selector: string, name: string) => {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, `${selector} is missing`);
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(css.slice(start, css.indexOf('}', start)));
  assert.ok(match, `${selector} declares no --${name}`);
  return match[1];
};

test('in the dark, Paper sets its words in a tinted ink, not pure white, and they still read at 4.5:1', () => {
  const system = token(CSS, DARK_SYSTEM, 'color-ink');
  assert.equal(token(CSS, DARK_CHOSEN, 'color-ink'), system, 'the two dark blocks agree');
  const ink = oklch(system);
  assert.ok(luminance(ink) < 0.99, `${system} is white`);
  for (const surface of ['color-paper', 'color-paper-2', 'color-paper-3', 'color-surface']) {
    const ratio = contrast(ink, oklch(token(TOKENS, ":root[data-theme='dark'] {", surface)));
    assert.ok(ratio >= 4.5, `ink on ${surface} is ${ratio.toFixed(2)}`);
  }
  // Over a photograph, on the hero's scrim, a slide's words are the full on-dark, not the muted.
  assert.match(within(SLIDES_OVER, '.hero-slide__body'), /color: var\(--color-on-dark\)/);
});

test('every word in Paper is Google Sans, Latin and Thai, with no IBM Plex Sans Thai', () => {
  for (const name of ['font-display', 'font-body']) {
    const family = token(CSS, LIGHT, name);
    assert.match(family, /^"Google Sans",/, `--${name} leads with Google Sans`);
    assert.doesNotMatch(family, /Plex/, `--${name} still names Plex`);
  }
  // The core's own tokens stay as the admin has them.
  assert.match(TOKENS, /--font-body: "IBM Plex Sans Thai"/);
});

test('a card is a hairline above square-cornered content, with one hover effect', () => {
  const card = body('.post-card');
  assert.doesNotMatch(card, /border:|border-radius|background/);
  assert.match(card, /border-block-start: var\(--rule-hair\) solid var\(--color-rule\)/);
  for (const selector of ['.post-card__cover', '.post-cover', '.post-card__title a::after']) {
    assert.doesNotMatch(body(selector), /radius/, `${selector} rounds a corner`);
  }
  for (const part of ['PostArticle', 'PageArticle']) {
    assert.doesNotMatch(read(`src/themes/paper/parts/${part}.astro`), /prose-img:rounded/, `${part} rounds its images`);
  }
  const hovers = RULES.filter(({ selector }) => selector.includes('.post-card:hover'));
  assert.deepEqual(hovers.map(({ selector }) => selector), ['.post-card:hover .post-card__title a']);
  assert.doesNotMatch(CSS, /scale\(1\.03\)/, 'the cover no longer zooms');
});

test('every hover sits inside (hover: hover), so a tap leaves nothing behind', () => {
  const loose = RULES
    .filter(({ selector }) => selector.includes(':hover'))
    .filter(({ context }) => !context.some((at) => /@media[^{]*\(hover: hover\)/.test(at)))
    .map(({ selector }) => selector);
  assert.deepEqual(loose, []);
});

test('the prose caps its measure in rem, and the quote and the error notice lose their stripes', () => {
  assert.match(body('.post-body > :is(p, ul, ol, blockquote, h2, h3)'), /max-inline-size: 33rem/);
  assert.match(body('.post-body blockquote'), /border-inline-start: var\(--rule-hair\) solid var\(--color-rule-strong\)/);
  assert.doesNotMatch(HOME, /border-l-2/);
  assert.match(body('.post-feed__error'), /border: var\(--rule-hair\) solid/);
});

test('a card with no cover shows its category on a flat band, not a huge repeated letter', () => {
  assert.doesNotMatch(CSS, /25cqi/);
  assert.doesNotMatch(HOME, /Intl\.Segmenter|initial\(/);
  assert.match(HOME, /post\.categories\?\.\[0\]\?\.name/);
  const band = body('.post-card__cover span');
  assert.match(band, /font-weight: 500/);
  assert.match(band, /text-overflow: ellipsis/);
  assert.match(body('.post-card__cover'), /aspect-ratio: 2 \/ 1/);
});

test('the home always has an h1, and a category is shown like a search: no band, and a heading', () => {
  assert.match(HOME, /const band = query \|\| activeCategory \? 'none'/);
  // One h1, outside every band, so hiding a band never takes it away; the text band's line is not it.
  assert.match(HOME, /<h1 class="sr-only">\{name\}<\/h1>\n\n\{band === 'slider'/);
  assert.equal(HOME.match(/<h1/g)?.length, 1);
  assert.match(HOME, /<p class="hero-title max-w-xl">\{headline\}<\/p>/);
  assert.match(HOME, /<h2 class="post-feed__heading">/);
  // A pill swaps the feed in place, heading and all; the band above it goes with that.
  assert.match(CSS, /main:has\(\.post-feed__heading\) \.home-hero \{ display: none; \}/);
  // The text hero's foot and head: 'the text hero is heavier at its foot' below.
  // An empty category offers the way back.
  assert.match(HOME, /activeCategory \? <>\{copy\.emptyCategory\} <a href=\{home\}>\{copy\.all\}<\/a><\/>/);
});

test('on a tablet the search spans the row above the pills, not alone at its right end', () => {
  assert.match(CSS, /@media \(max-width: 63\.999rem\) \{ \.post-search, \.post-search:focus-within \{ flex-basis: 100%; max-width: none; \} \}/);
});

test('below 64rem the slide words sit under a whole picture; from 64rem over it, on a short scrim', () => {
  // The header's frame: max-w-7xl (80rem) with px-5, and px-7 from the 600px breakpoint.
  const words = body('.hero-slide__words');
  assert.match(words, /padding-inline: calc\(max\(0px, \(100% - 80rem\) \/ 2\) \+ 1\.25rem\)/);
  assert.doesNotMatch(words, /48rem/);
  // A phone and a tablet: the picture in the flow, nothing drawn over it, the words in the page's ink.
  assert.doesNotMatch(body('.hero-slide > img'), /position: absolute/);
  assert.match(words, /color: var\(--color-ink\)/);
  assert.match(body('.hero-slide__body'), /color: var\(--color-ink-2\)/);
  const narrowOverlays = RULES.filter(({ selector, context }) => /\.hero-slide.*::(after|before)/.test(selector) && !context.includes(SLIDES_OVER));
  assert.deepEqual(narrowOverlays.map(({ selector }) => selector), [], 'no scrim below 64rem');
  assert.match(within('@media (max-width: 63.999rem)', '.home-hero--slides .hero-slider__controls'), /position: static/);
  assert.equal(within(WIDE, '.hero-slide > img'), '', 'a 768px slide is not covered by its words');
  // From 64rem: over the picture at its foot, never lifted to the middle.
  assert.match(within(SLIDES_OVER, '.hero-slide > img'), /position: absolute/);
  assert.match(within(SLIDES_OVER, '.hero-slide'), /align-content: end/);
  assert.doesNotMatch(CSS, /align-content: center/);
  // Soft fades in from clear over a short --hero-fade above the words, and is deepest (70%) under
  // them: most of the picture stays clear (it was 14rem, which covered nearly all of it).
  const scrim = within(SLIDES_OVER, ".hero-slide[data-overlay='soft'] .hero-slide__words::before");
  assert.match(scrim, /--hero-fade: 6rem/);
  assert.match(scrim, /inset: calc\(-1 \* var\(--hero-fade\)\) 0 0/);
  assert.match(scrim, /linear-gradient\(to bottom,\s*transparent,/);
  assert.match(scrim, /color-mix\(in oklch, var\(--color-hero\) 70%, transparent\) var\(--hero-fade\)\)/);
  // Words at the start never reach the slider's buttons at the end, so only centred or end words
  // stop above them; the start's scrim is no taller than its words.
  assert.equal(within(SLIDES_OVER, '.home-hero--slides[data-hero-slider] .hero-slide__words'), '');
  assert.match(within(SLIDES_OVER, ".home-hero--slides[data-hero-slider] .hero-slide:not([data-align='start']) .hero-slide__words"), /padding-block-end: calc\(2\.75rem \+ var\(--space-lg\) \* 2\)/);
  // The scrim runs the slide's full width: the slider's buttons stay above it, seen and pressable.
  const layer = (selector: string) => Number(/z-index: (\d+)/.exec(body(selector))?.[1] ?? 0);
  assert.ok(layer('.hero-slider__controls') > layer('.hero-slide__words'));
});

test('pressed controls answer, and on a touch screen each is a full target', () => {
  for (const selector of ['.post-filter a:active', '.post-search__submit:active', '.hero-slider__step:active', '.hero-slide__button:active', '.site-footer p a:active']) {
    assert.ok(RULES.some((rule) => rule.selector.split(/,\s*/).includes(selector)), `${selector} has no pressed state`);
  }
  const coarse = RULES.filter(({ context }) => context.some((at) => /\(pointer: coarse\)/.test(at)));
  for (const selector of ['.post-filter a', '.post-search__submit', '.site-footer p a']) {
    assert.ok(coarse.some((rule) => rule.selector.split(/,\s*/).includes(selector)), `${selector} is not sized for a finger`);
  }
});

test('the header on a phone: the language as its code, and the Menu with the submenu chevron', () => {
  const narrow = RULES.filter(({ context }) => context.some((at) => at === '@media (max-width: 39.999rem)'));
  const content = (selector: string) => narrow.find((rule) => rule.selector === selector)?.body ?? '';
  // Outweighing the switcher's own scoped rules (two classes) whichever sheet loads last.
  assert.match(content('.site-header .language-switcher .language-switcher__trigger'), /width: auto/);
  assert.match(content('.site-header .language-switcher .language-switcher__trigger::before'), /content: 'EN'/);
  assert.match(content('.site-header .language-switcher .language-switcher__trigger:lang(th)::before'), /content: 'TH'/);
  assert.match(content('.site-header .language-switcher .language-switcher__trigger > span'), /display: none/);
  assert.match(body('.site-header .language-switcher'), /font-size: var\(--text-sm\)/);
  const header = read('src/themes/paper/parts/Header.astro');
  assert.match(header, /<summary><span>\{copy\.menu\}<\/span><Icon name="down" \/><\/summary>/);
  assert.match(body('.site-header__mobile summary'), /list-style: none/);
});

test("the footer's rule runs the width of the header's, with the words held to the content edge", () => {
  const footer = read('src/themes/paper/parts/Footer.astro');
  assert.match(footer, /<footer class="border-t border-line">\s*<div class="site-footer mx-auto w-full max-w-7xl px-5 py-7 text-sm text-muted sm:px-7">/);
});

test('inline code is a quiet tint in the line, not a word between backticks', () => {
  const code = body('.post-body :not(pre) > code');
  assert.match(code, /background: var\(--color-paper-3\)/);
  assert.match(code, /border-radius: var\(--radius-sm\)/);
});

test("an article's edge is the header's on a phone, and the missing page's everywhere", () => {
  // The header and the 404 block are px-5, and px-7 from the 600px (37.5rem) breakpoint.
  assert.match(body('.post-page'), /padding: var\(--space-xl\) 1\.25rem var\(--space-3xl\)/);
  assert.match(within('@media (min-width: 37.5rem)', '.post-page'), /padding-inline: 1\.75rem/);
});

test('the text hero is heavier at its foot than its head, at every width', () => {
  const band = /<div class="mx-auto max-w-7xl px-5 (pt-\d+) (pb-\d+) sm:px-7 sm:(pt-\d+) sm:(pb-\d+)">/.exec(HOME);
  assert.ok(band, 'the text band');
  const size = (utility: string) => Number(utility.split('-')[1]);
  assert.ok(size(band[2]) >= 1.3 * size(band[1]), `${band[1]} ${band[2]}`);
  assert.ok(size(band[4]) >= 1.3 * size(band[3]), `sm: ${band[3]} ${band[4]}`);
});

test('a search names its list in a heading, and says what it found in a status of its own', () => {
  // A live region around the h2 read the heading out again on every swap.
  assert.match(HOME, /<div class="post-search__status">\s*<h2 class="post-feed__heading">\{saying\(shared\.searchResults\)\}<\/h2>/);
  assert.match(HOME, /<p class="sr-only" role="status">\{saying\(shared\.searchResults\)\}<\/p>/);
  assert.doesNotMatch(HOME, /<div class="post-search__status" role="status">/);
  // During a search no pill is the list on screen, "All posts" included.
  assert.match(HOME, /<li><a href=\{home\} aria-current=\{activeCategory \|\| query \? undefined : 'page'\}>\{copy\.all\}<\/a><\/li>/);
});

test('on a touch screen the small links are a full target that never overlaps the next, and they answer a press', () => {
  const coarse = RULES.filter(({ context }) => context.some((at) => /\(pointer: coarse\)/.test(at)));
  for (const selector of ['.site-footer p a', '.post-more > a', '.post-search__status a', '.post-feed__empty a']) {
    const rule = coarse.find((candidate) => candidate.selector.split(/,\s*/).includes(selector));
    assert.ok(rule, `${selector} is not sized for a finger`);
    // Padding on an inline link reaches over the line above and below; a box of its own does not.
    assert.match(rule.body, /display: inline-flex/, selector);
    assert.match(rule.body, /min-block-size: var\(--control-height\)/, selector);
    assert.doesNotMatch(rule.body, /padding-block/, selector);
  }
  assert.ok(RULES.some((rule) => rule.selector.split(/,\s*/).includes('.post-more > a:active')), 'Older posts has no pressed state');
});

test('the shell fills the small viewport, so a phone toolbar does not push the footer below the fold', () => {
  assert.match(read('src/themes/paper/Shell.astro'), /<body class="paper flex min-h-svh flex-col">/);
});

test('in a category view a coverless card shows a plain tile, not the category the heading already names', () => {
  assert.match(HOME, /: !activeCategory && <span>\{post\.categories\?\.\[0\]\?\.name \?\? name\}<\/span>\}/);
});

test('the header is read in the order it is drawn: the language, then the theme', () => {
  const header = read('src/themes/paper/parts/Header.astro');
  assert.ok(header.indexOf('<LanguageSwitcher') < header.indexOf('<ThemeToggle'), 'Tab reached the theme button before the language to its left');
});

test("the post's cover does not say the title again", () => {
  assert.match(read('src/themes/paper/parts/PostArticle.astro'), /<img class="post-cover" src=\{cover\} alt="" /);
});

test("the slider's buttons end at the content edge, where the grid and the footer do", () => {
  assert.match(body('.hero-slider__controls'), /inset: auto calc\(max\(0px, \(100% - 80rem\) \/ 2\) \+ 1\.25rem\) var\(--space-lg\) auto/);
  assert.match(within('@media (min-width: 37.5rem)', '.hero-slider__controls'), /inset-inline-end: calc\(max\(0px, \(100% - 80rem\) \/ 2\) \+ 1\.75rem\)/);
});

test('a code block and a file card are ruled above and below, not rounded boxes', () => {
  assert.match(body('.post-body :is(pre, pre.code-block)'), /border-inline: 0; border-radius: 0/);
  const card = body('.post-body p.file-card > :is(a, .file-card__link)');
  assert.match(card, /border-inline: 0/);
  assert.match(card, /border-radius: 0/);
  assert.match(card, /border-color: var\(--color-rule-strong\)/);
});
