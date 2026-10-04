import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { leadsWith } from '../../src/themes/plain/lead';
import { thaiDeclarations } from '../helpers/css';

const read = (path: string) => readFileSync(new URL(`../../src/themes/plain/${path}`, import.meta.url), 'utf8');
const css = read('theme.css');

test('the newest post leads only on the first page of an unsearched list', () => {
  assert.equal(leadsWith({ cursor: undefined, posts: 3, query: undefined }), true);
  assert.equal(leadsWith({ cursor: undefined, posts: 1, query: undefined }), true);
  assert.equal(leadsWith({ cursor: 'abc', posts: 3, query: undefined }), false, 'a later page has no lead');
  assert.equal(leadsWith({ cursor: undefined, posts: 3, query: 'compost' }), false, 'results are not a front page');
  assert.equal(leadsWith({ cursor: undefined, posts: 0, query: undefined }), false, 'nothing to lead with');
});

test('the home page draws the lead, and a category filter does not stop it', () => {
  const home = read('Home.astro');
  assert.match(home, /leadsWith\(\{ cursor, posts: posts\.length, query \}\)/);
  assert.match(home, /<article class="plain-lead">/);
  assert.match(home, /<ol class="plain-grid">/);
  assert.doesNotMatch(home, /activeCategory[^\n]*leadsWith|leadsWith[^\n]*activeCategory/);
});

test('search is one field with the magnifier inside it as the submit, and no text button', () => {
  const home = read('Home.astro');
  assert.match(home, /<button class="plain-search__submit" type="submit" aria-label=\{copy\.search\} title=\{copy\.search\}><Icon name="search" \/><\/button>/);
  assert.doesNotMatch(home, /\{copy\.search\}<\/button>/);
  assert.doesNotMatch(css, /wrap-reverse/);
});

test('the header, the page and the footer share one frame of 80rem with the gutter Paper uses', () => {
  assert.match(css, /--plain-frame: min\(100% - 2 \* var\(--plain-gutter\), 80rem - 2 \* var\(--plain-gutter\)\)/);
  assert.match(css, /--plain-gutter: 1\.25rem/);
  assert.match(css, /@media \(min-width: 40rem\) \{[^}]*--plain-gutter: 1\.75rem/);
  assert.match(css, /\.plain-head,\s*\.plain-foot,\s*\.plain-page \{[^}]*width: var\(--plain-frame\)/);
});

test('an article keeps its 44rem column inside the frame', () => {
  assert.match(css, /\.plain-article \{[^}]*width: min\(var\(--plain-frame\), 44rem\)/);
});

test("an article's and a page's title is as bold as the home page's lead", () => {
  const weight = (selector: string) => css.match(new RegExp(`${selector} \\{[^}]*font-weight: (\\d+)`))?.[1];
  assert.equal(weight('\\.plain-lead h2'), '700');
  assert.equal(weight('\\.plain-article h1'), weight('\\.plain-lead h2'));
});

test('the grid fits as many 18rem columns as the frame holds, and its posts share the width, each under a hairline', () => {
  // auto-fit, not auto-fill: two posts on a wide screen are halves, never two thirds and an empty third.
  assert.match(css, /\.plain-grid \{[^}]*grid-template-columns: repeat\(auto-fit, minmax\(min\(18rem, 100%\), 1fr\)\)/);
  assert.doesNotMatch(css, /\.plain-grid \{ grid-template-columns: repeat\([23], 1fr\)/);
  assert.match(css, /\.plain-grid > li \{[^}]*border-block-start: var\(--rule-hair\) solid var\(--color-rule\)/);
  assert.match(css, /-webkit-line-clamp: 3;\s*line-clamp: 3;/);
});

test('the active tab is ink with a 2px link bar', () => {
  assert.match(css, /\.plain-filter a\[aria-current="page"\] \{[^}]*font-weight: 600[^}]*border-block-end-color: var\(--color-link\)/);
  assert.match(css, /border-block-end: 2px solid transparent/);
});

test('search is first on a phone in sight and in tab order: it comes before the tabs in the page, and goes to the row\'s end on a wide screen', () => {
  const home = read('Home.astro');
  assert.ok(home.indexOf('<form class="plain-search"') < home.indexOf('<nav class="plain-filter"'), 'the form is before the tabs in the source');
  assert.doesNotMatch(css, /order: -1/, 'nothing is drawn out of its source order');
  assert.match(css, /\.plain-search \{[^}]*order: 1/, 'wide: the field sits after the tabs');
  assert.match(css, /@media \(max-width: 39\.999rem\) \{[^}]*\.plain-search \{[^}]*order: 0; flex-basis: 100%/, 'phone: back in source order, on its own row');
});

test("the footer's credit is its own paragraph at the right, and wraps under the copyright on a phone", () => {
  const shell = read('Shell.astro');
  // Plain says it in plain text: the word Paper links is just the name here.
  assert.match(shell, /<p class="plain-foot__credit">\{poweredByText\(copy\)\}<\/p>/);
  assert.doesNotMatch(shell, /\$\{copy\.poweredBy\}|` \$\{copy/);
  assert.match(css, /\.plain-foot__credit \{ margin-inline-start: auto; \}/);
  assert.match(css, /@media \(max-width: 39\.999rem\) \{[^}]*\.plain-foot__credit \{ flex-basis: 100%; margin-inline-start: 0; \}/);
});

test('the file headers no longer say one column', () => {
  for (const file of ['Shell.astro', 'theme.css', 'index.ts', 'theme.ts']) {
    assert.doesNotMatch(read(file), /one column/i, `${file} describes the old shape`);
  }
});

test("Plain's search field shows one focus line, as Paper's does, and its button keeps its ring", () => {
  const rule = /\.plain-search input:focus-visible \{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(rule, /outline: 2px solid transparent;/, 'no visible outer ring, but one forced-colors can paint');
  assert.match(rule, /border-color: var\(--color-accent\);/);
  assert.match(rule, /box-shadow: inset 0 0 0 var\(--rule-hair\) var\(--color-accent\);/);
  assert.match(css, /\.plain-search__submit:focus-visible \{ outline: 2px solid var\(--color-focus\);/);
});

/** The declarations of the first rule whose selector list is exactly `selector`. */
const rule = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';
};

test("a post's headings are headings: h2 and h3 sized off the scale and bold, h4 to h6 semi-bold", () => {
  // Tailwind's preflight sets every heading to the body's size and weight; Paper and Almanac
  // put theirs back inside a prose class, and Plain's body had nothing.
  assert.match(rule('.plain-body h2'), /font-size: var\(--plain-text-h2\);/);
  assert.match(rule('.plain-body h2'), /font-weight: 700;/);
  assert.match(rule('.plain-body h3'), /font-size: var\(--text-xl\);/);
  assert.match(rule('.plain-body h3'), /font-weight: 700;/);
  assert.match(rule('.plain-body :is(h4, h5, h6)'), /font-weight: 600;/);
  // The margin and the leading they already had stay.
  assert.match(rule('.plain-body h2, .plain-body h3'), /margin-block-start: var\(--space-xl\); line-height: 1\.3;/);
});

test("a post's lists keep their markers, their indent and a gap between items, nested or holding two paragraphs", () => {
  assert.match(rule('.plain-body :is(ul, ol)'), /padding-inline-start: var\(--space-lg\);/);
  assert.match(rule('.plain-body ul'), /list-style: disc;/);
  assert.match(rule('.plain-body ol'), /list-style: decimal;/);
  assert.match(css, /\.plain-body li \+ li,\s*\.plain-body li > :is\(ul, ol\) \{ margin-block-start: var\(--space-2xs\); \}/);
  // The editor wraps every item's text in a paragraph, and preflight zeroes a paragraph's margin.
  assert.match(rule('.plain-body li > p + p'), /margin-block-start: var\(--space-xs\);/);
  assert.match(rule('.plain-body li::marker'), /color: var\(--color-muted\);/);
});

test('inline code in a post is set apart from the words around it', () => {
  const code = rule('.plain-body :not(pre) > code');
  assert.match(code, /background: var\(--color-code-surface\);/);
  assert.match(code, /border-radius: var\(--radius-sm\);/);
  assert.match(code, /font-size: 0\.875em;/);
});

test('Thai display type in Plain is not tracked in, and its two-line titles have room for the marks', () => {
  for (const target of ['.plain-wordmark', '.plain-lead h2', '.plain-article h1']) {
    assert.match(thaiDeclarations(css, target), /letter-spacing: 0/, `${target} keeps its tracking in Thai`);
  }
  for (const target of ['.plain-lead h2', '.plain-article h1']) {
    assert.match(thaiDeclarations(css, target), /line-height: 1\.4/, `${target} is set tight in Thai`);
  }
  // Latin keeps today's values.
  assert.match(css, /\.plain-lead h2 \{[^}]*letter-spacing: -0\.015em; line-height: 1\.2;/);
  assert.match(css, /\.plain-article h1 \{[^}]*line-height: 1\.2;/);
});

/*
 * Plain on a phone and in Google Sans (1.14.0, D4 and spec §3): read from the stylesheet and the
 * templates, as above; tests/e2e/home-search.spec.ts sees the page.
 */
const PLAIN = css.replace(/\/\*[\s\S]*?\*\//g, '');
const CODE = readFileSync(new URL('../../src/styles/code.css', import.meta.url), 'utf8');

/** Every rule as [the at-rules it sits in, its own selector, its declarations]. Almanac's and Paper's tests keep the same walker. */
function parse(source: string): Array<{ context: string[]; selector: string; body: string }> {
  const found: Array<{ context: string[]; selector: string; body: string }> = [];
  const stack: string[] = [];
  let prelude = '';
  for (let at = 0; at < source.length; at += 1) {
    const char = source[at];
    if (char === '{') {
      const selector = prelude.trim();
      const close = source.indexOf('}', at);
      const nextOpen = source.indexOf('{', at + 1);
      if (!selector.startsWith('@') && (nextOpen === -1 || nextOpen > close)) {
        found.push({ context: [...stack], selector, body: source.slice(at + 1, close) });
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

const RULES = parse(PLAIN);
/** The declarations of `selector` at the top level, or inside the at-rule written exactly as `at`. */
const top = (selector: string, at?: string) => RULES
  .filter((candidate) => candidate.selector === selector && (at ? candidate.context.includes(at) : !candidate.context.length))
  .map(({ body }) => body)
  .join(';');
const NARROW = '@media (max-width: 63.999rem)';
const COARSE = '@media (pointer: coarse)';
const HOVER = '@media (hover: hover)';

test('every word in Plain is Google Sans, Latin and Thai, through the font tokens', () => {
  const block = top(':root:has(> body.plain, .plain-article)');
  for (const name of ['font-display', 'font-body']) {
    const family = new RegExp(`--${name}: ([^;]+);`).exec(block)?.[1] ?? '';
    assert.match(family, /^"Google Sans",/, `--${name} leads with Google Sans`);
    assert.match(family, /sans-serif$/, `--${name} falls back to a sans`);
    assert.doesNotMatch(family, /Plex/, `--${name} still names Plex`);
  }
  assert.match(top('.plain'), /font-family: var\(--font-body\);/);
  // A family is named only in the token block: no literal anywhere else. The © alone takes the system face.
  for (const rule of RULES.filter(({ selector }) => selector !== ':root:has(> body.plain, .plain-article)')) {
    assert.doesNotMatch(rule.body, /font-family:(?! var\(--font-(body|display|mono|system)\)| inherit)/, `${rule.selector} names a face`);
  }
  for (const file of ['Shell.astro', 'theme.css', 'index.ts', 'theme.ts']) {
    assert.doesNotMatch(read(file), /system font|reader's own font/i, `${file} describes the old face`);
  }
  // The code block's label is drawn in the page's face, which the token now is.
  assert.match(CODE, /pre\[data-language\]::before \{[^}]*font-family: var\(--font-body\);/);
});

test("Plain's overscroll is its own white, not the cream behind the other themes", () => {
  assert.match(top('html:has(> body.plain)'), /background: var\(--color-paper\);/);
});

test('the shell is at least a small viewport tall, so a phone toolbar does not leave a gap', () => {
  assert.match(top('.plain'), /min-height: 100svh;/);
  assert.doesNotMatch(PLAIN, /100vh/);
});

test("a post's running text spans the article's column, with no measure in ch", () => {
  // 1.14.1: the owner wants the words as wide as the pictures beside them, so no narrower cap.
  assert.doesNotMatch(PLAIN, /\.plain-body > :is\([^)]*\) \{ max-inline-size/);
  assert.doesNotMatch(PLAIN, /\dch\b/, 'no measure in ch, which counts Thai badly');
});

test('the cover stands off the first paragraph, and does not say the title again', () => {
  assert.match(top('.plain-article > img'), /margin-block-end: var\(--space-lg\);/);
  const post = read('Post.astro');
  assert.match(post, /<img src=\{cover\} alt="" /);
  assert.doesNotMatch(post, /alt=\{post\.title\}/);
});

test('a body h2 is 28px off Plain\'s own token, a clear step above h3', () => {
  assert.match(css, /--plain-text-h2: 1\.75rem;/);
});

test("Plain's code block is a rule above and below: no radius, no side borders", () => {
  const block = top('.plain-body :is(pre, pre.code-block)');
  assert.match(block, /border-inline: 0;/);
  assert.match(block, /border-radius: 0;/);
  assert.match(block, /border-block: var\(--rule-hair\) solid var\(--color-rule-strong\);/);
  assert.doesNotMatch(CODE, /both themes/, 'code.css still counts two themes');
});

test('a hover is only a hover where a pointer really hovers', () => {
  const hovers = RULES.filter(({ selector }) => selector.includes(':hover'));
  assert.ok(hovers.length > 0);
  for (const rule of hovers) assert.ok(rule.context.includes(HOVER), `${rule.selector} hovers on a tap`);
});

test('the lead and the article title run across the frame, and a grid title wraps in balanced lines', () => {
  // 1.14.1: balance halved a long lead title across the frame; pretty fills the line and only keeps
  // a last word company.
  assert.match(top('.plain-lead h2'), /text-wrap: pretty;/);
  assert.doesNotMatch(top('.plain-lead p'), /max-width/);
  // 1.15.0: the article title fills its line too; only the narrow grid titles balance.
  assert.match(top('.plain-article h1'), /text-wrap: pretty;/);
  assert.match(top('.plain-grid h2'), /text-wrap: balance;/);
});

test('the © is drawn in the system face, where Google Sans draws it as a small raised mark', () => {
  assert.match(read('Shell.astro'), /<span class="copyright-mark">&copy;<\/span>/);
  assert.match(css, /\.copyright-mark \{ font-family: var\(--font-system\); \}/);
});

test('type sizes come off the scale, with a lead size of Plain\'s own', () => {
  assert.doesNotMatch(PLAIN, /font-size: (clamp|[\d.]+rem)/, 'a literal size');
  assert.match(top('.plain'), /--plain-text-lead: 1\.125rem;/);
  assert.match(top('.plain-lead p'), /font-size: var\(--plain-text-lead\);/);
  assert.match(top('.plain-grid time'), /font-size: var\(--text-xs\);/);
});

test('below 64rem the tabs are one row that scrolls sideways, with the rule under them and not the search', () => {
  assert.match(top('.plain-controls', NARROW), /border-block-end: 0;/);
  const row = top('.plain-filter', NARROW);
  assert.match(row, /flex-wrap: nowrap;/);
  assert.match(row, /overflow-x: auto;/);
  assert.match(row, /scrollbar-width: none;/);
  assert.match(row, /scroll-padding-inline: /, 'a tab that takes focus comes into view clear of the edge');
  // The rule is the row's own, drawn inside it, so the scroller does not clip the bar on it.
  assert.match(row, /box-shadow: inset 0 calc\(-1 \* var\(--rule-hair\)\) var\(--color-rule\);/);
  assert.match(top('.plain-filter a', NARROW), /margin-block-end: 0;/);
  assert.match(top('.plain-filter::-webkit-scrollbar', NARROW), /display: none;/);
  // A clipped ring is no ring: it is drawn inside the tab.
  assert.match(top('.plain-filter a:focus-visible'), /outline-offset: -2px;/);
});

test('header, footer, back, paging and search-status links are a full target on a touch screen', () => {
  const touch = top(':is(.plain-nav, .plain-foot, .plain-back, .plain-more, .plain-search-status, .plain-empty) a, .plain-wordmark', COARSE);
  assert.match(touch, /display: inline-flex;/);
  assert.match(touch, /min-height: var\(--plain-field\);/);
  assert.match(touch, /min-inline-size: var\(--plain-field\);/, 'a short word such as TH is a full target across too');
  // A post's title grows by padding on its inline link, which moves nothing around it.
  assert.match(top(':is(.plain-lead, .plain-grid) h2 a', COARSE), /padding-block: var\(--space-sm\);/);
  assert.match(top('.plain-nav .site-submenu a', COARSE), /padding-block: var\(--space-sm\);/);
  // And a press shows on them, with a mouse as with a finger, as on the tabs and the search button.
  assert.match(top(':is(.plain-nav, .plain-foot, .plain-back, .plain-more) a:active, .plain-wordmark:active'), /translate: 0 1px;/);
  // A translate moves only a box, so each of them is one at every width, not an inline run of words.
  assert.match(top(':is(.plain-nav, .plain-foot, .plain-back, .plain-more) a'), /display: inline-block;/);
  // The underline is the text's, so a taller link keeps it under the words.
  assert.match(top('.plain-nav a,\n.plain-foot a'), /text-decoration-color: transparent;/);
  assert.doesNotMatch(top('.plain-nav a,\n.plain-foot a'), /border-block-end/);
});

test("the theme button is quiet in Plain's header: no ring, the field's size, a fill on hover", () => {
  const button = top('.plain-nav .ui-theme__trigger');
  assert.match(button, /width: var\(--plain-field\);/);
  assert.match(button, /height: var\(--plain-field\);/);
  assert.match(button, /border-color: transparent;/);
  assert.match(top('.plain-nav .ui-theme__trigger:hover', HOVER), /border-color: transparent; background: var\(--color-paper-2\);/);
});

test('the tab row is scrolled sideways only: the page itself never moves for it', () => {
  const script = /<script>([\s\S]*?)<\/script>/.exec(read('Home.astro'))?.[1] ?? '';
  assert.match(script, /row\.scrollLeft \+=/);
  assert.match(script, /addEventListener\('focusin'/);
  assert.doesNotMatch(script, /scrollIntoView/, 'scrollIntoView can scroll the page as well');
});

test('a tab and the search button answer a press', () => {
  assert.match(top('.plain-filter a:active'), /color: var\(--color-ink\);/);
  assert.match(top('.plain-search__submit:active'), /translate: 0 1px;/);
});

test('the home names its copy from the core, and says why a list is empty', () => {
  const home = read('Home.astro');
  assert.match(home, /const name = siteName\.trim\(\) \|\| 'TomeCMS';/);
  assert.match(home, /<h1 class="sr-only">\{name\}<\/h1>/);
  assert.match(home, /\{copy\.morePosts\} <span aria-hidden="true">→<\/span>/);
  assert.match(home, /query \? saying\(copy\.noResults\) : activeCategory \?/);
  assert.match(home, /copy\.noPostsInCategory/);
  assert.match(home, /copy\.noPosts\b/);
  assert.match(home, /role="alert">\{copy\.postsUnavailable\}/);
  assert.doesNotMatch(home, /temporarily unavailable|ขณะนี้/, 'its own copy of the core\'s words');
  // The failure comes before the list it explains.
  assert.ok(home.indexOf('copy.postsUnavailable') < home.indexOf('<ol class="plain-grid">'));
  assert.match(home, /aria-current=\{activeCategory \|\| query \? undefined : 'page'\}/);
});

test("the missing page is titled at Plain's article size, untracked, on the article's 44rem column", () => {
  const title = top('.plain .article-title');
  assert.match(title, /font-size: var\(--text-title\)/);
  assert.match(title, /letter-spacing: normal/);
  // The core block is 48rem with a gutter of its own; in Plain it is the article's column.
  const block = top('.plain .notice-page');
  assert.match(block, /width: min\(var\(--plain-frame\), 44rem\)/);
  assert.match(block, /max-width: none/);
  assert.match(block, /padding-inline: 0/);
});

test('the tab row shows that it scrolls: an edge fades where there is more, and a neighbour peeks in', () => {
  const row = top('.plain-filter', NARROW);
  // A tab scrolled in stops this far from the edge, more than the gap, so part of the next one shows.
  assert.match(row, /scroll-padding-inline: var\(--space-xl\);/);
  assert.match(top('.plain-filter'), /gap: 0 var\(--space-lg\);/);
  assert.match(row, /mask-image: linear-gradient\(to right, transparent, currentColor var\(--plain-fade-start\), currentColor calc\(100% - var\(--plain-fade-end\)\), transparent\);/);
  assert.match(top(".plain-filter[data-more~='start']", NARROW), /--plain-fade-start: var\(--space-xl\);/);
  assert.match(top(".plain-filter[data-more~='end']", NARROW), /--plain-fade-end: var\(--space-xl\);/);
  const script = /<script>([\s\S]*?)<\/script>/.exec(read('Home.astro'))?.[1] ?? '';
  assert.match(script, /row\.dataset\.more = /);
  assert.match(script, /addEventListener\('scroll', mark/);
});

test('an empty category names itself in a heading, since it has no tab to mark', () => {
  const home = read('Home.astro');
  assert.match(home, /\{activeCategory && !query && !categories\.some\(\(\{ name \}\) => isCurrent\(name\)\) && <h2 class="plain-list-heading">\{activeCategory\}<\/h2>\}/);
  assert.match(top('.plain-list-heading'), /font-size: var\(--text-xl\)/);
});

test('a file card is ruled above and below, as the code block is, not a rounded box', () => {
  const card = top('.plain-body p.file-card > :is(a, .file-card__link)');
  assert.match(card, /border-inline: 0/);
  assert.match(card, /border-radius: 0/);
  assert.match(card, /border-color: var\(--color-rule-strong\)/);
});
