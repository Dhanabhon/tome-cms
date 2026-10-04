import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * Almanac in 1.14.0 (D3 and the group-C fixes): a coverless card is a band in its category's tone
 * with the category's name, one hover effect, pressed states, a finger's targets, and a reading
 * measure in em. Read from the stylesheet and the templates; tests/e2e/almanac.spec.ts sees the page.
 */
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const CSS = read('src/themes/almanac/theme.css').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every rule as [the at-rules it sits in, its own selector, its declarations]. */
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
const selectors = (rule: { selector: string }) => rule.selector.split(/,\s*/);
const named = (selector: string) => RULES.filter((rule) => selectors(rule).includes(selector));
const body = (selector: string) => {
  const rule = RULES.find((candidate) => candidate.selector === selector && !candidate.context.length);
  assert.ok(rule, `no top-level rule for ${selector}`);
  return rule.body;
};
const within = (condition: RegExp) => RULES.filter(({ context }) => context.some((at) => condition.test(at)));

test('a card with no cover is a band in its category\'s tone, drawn from tone tokens alone', () => {
  const band = body('.almanac-card__band');
  // The cover's 16:9, so a row that mixes bands and covers starts its titles level (it was 3:1).
  assert.match(band, /aspect-ratio: 16 \/ 9/);
  assert.match(body('.almanac-card__panel'), /aspect-ratio: 16 \/ 9/);
  // The name says the category under the title's voice: smaller and lighter than the title.
  assert.match(band, /font-size: var\(--text-md\)/);
  assert.match(band, /font-weight: 400/);
  assert.match(body('.almanac-card__title'), /font-size: var\(--text-xl\)/);
  assert.match(band, /background: var\(--card-tone, var\(--almanac-tone-0\)\)/);
  assert.match(band, /color: var\(--card-tone-ink, var\(--almanac-tone-0-ink\)\)/);
  assert.match(band, /font-family: var\(--font-display\)/, 'the name is set in Trirong');
  // Nothing else colours it: no core surface or ink a dark block could leave behind.
  for (const [, value] of band.matchAll(/(?:^|;)\s*(?:background|color|border[a-z-]*)\s*:\s*([^;]+)/g)) {
    for (const [name] of value.matchAll(/--[a-z0-9-]+/g)) assert.match(name, /^--(card|almanac)-tone(-\d)?(-ink)?$/, `the band reads ${name}`);
  }
  // The name stays on one line, and a long one ends in an ellipsis.
  const name = body('.almanac-card__band span');
  for (const declaration of [/white-space: nowrap/, /overflow: hidden/, /text-overflow: ellipsis/]) assert.match(name, declaration);
  // The card sets those two from the theme's six tones, and the letter circle is gone.
  const card = read('src/themes/almanac/parts/PostCard.astro');
  assert.match(card, /--card-tone: var\(--almanac-tone-\$\{panel\.tone\}\); --card-tone-ink: var\(--almanac-tone-\$\{panel\.tone\}-ink\);/);
  assert.doesNotMatch(CSS + card, /almanac-card__letter/);
});

test('every hover waits for a pointer that can hover', () => {
  const loose = RULES.filter((rule) => /:hover/.test(rule.selector) && !rule.context.some((at) => /\(hover: hover\)/.test(at)));
  assert.deepEqual(loose.map(({ selector }) => selector), []);
});

test('a card answers a hover with one thing: its title takes the link colour', () => {
  const hovered = RULES.filter((rule) => /\.almanac-card__link:hover/.test(rule.selector));
  assert.deepEqual(hovered.map(({ selector, body: declarations }) => [selector, declarations.trim()]), [
    ['.almanac-card__link:hover .almanac-card__title', 'color: var(--color-link);'],
  ]);
  // No lift and no shadow, at rest or in motion.
  for (const rule of RULES.filter(({ selector }) => /\.almanac-card__link/.test(selector))) {
    assert.doesNotMatch(rule.body, /box-shadow|transform|transition/, rule.selector);
  }
});

test('the buttons, the pills, the search, the Menu and a card answer a press', () => {
  for (const selector of ['.almanac-button:active', '.almanac-pills a:active', '.almanac-search__submit:active', '.almanac-search-toggle:active', '.almanac-article__pill:active', '.almanac-header__mobile summary:active', '.almanac-card__link:active .almanac-card__title']) {
    assert.ok(named(selector).length, `${selector} has no pressed state`);
  }
});

test('on a touch screen the footer\'s links, "Clear search", "All posts" and the post\'s category are a finger\'s size', () => {
  const coarse = within(/\(pointer: coarse\)/);
  for (const selector of ['.almanac-footer p a', '.almanac-footer__nav a', '.almanac-feed__clear a', '.almanac-feed__empty a', '.almanac-article__pill']) {
    assert.ok(coarse.some((rule) => selectors(rule).includes(selector)), `${selector} is not sized for a finger`);
  }
});

test('the hero buttons and "More in" stay on one line, cut short rather than wrapped', () => {
  for (const selector of ['.almanac-button__label', '.almanac-article__more-label']) {
    const declarations = body(selector);
    for (const declaration of [/white-space: nowrap/, /overflow: hidden/, /text-overflow: ellipsis/]) assert.match(declarations, declaration, selector);
  }
  assert.match(body('.almanac-button'), /max-width: 100%/);
  assert.match(read('src/themes/almanac/parts/Hero.astro'), /<span class="almanac-button__label">\{label\}<\/span>/);
});

test('a post reads at 44em, its emphasis is a weight, and its meta keeps each dot with what follows', () => {
  assert.match(body('.almanac-article'), /inline-size: min\(100% - 2 \* var\(--almanac-gutter, 1\.25rem\), 44em\)/, '35em read as a narrow strip (1.14.1)');
  assert.doesNotMatch(body('.almanac-article'), /\dch\b/, 'no measure in ch, which counts Thai badly');
  assert.match(body('.almanac-prose em'), /font-weight: 500/);
  assert.doesNotMatch(body('.almanac-prose em'), /italic/);
  const post = read('src/themes/almanac/Post.astro');
  assert.doesNotMatch(post, /<span aria-hidden="true">·<\/span>/, 'no dot of its own to end a line on');
  assert.equal(post.match(/<span aria-hidden="true" class="almanac-article__dot">·<\/span>/g)?.length, 2);
});

test('on a phone a body h2 is smaller than the title above it', () => {
  const narrow = within(/max-width: 39\.999rem/);
  assert.ok(narrow.some((rule) => rule.selector === '.almanac-prose h2' && /font-size: 1\.3em/.test(rule.body)));
});

test('the hero is heavier at its foot than at its head', () => {
  const space = { xl: 2.5, '2xl': 4, '3xl': 5 } as Record<string, number>;
  const paddings = RULES.filter(({ selector }) => selector === '.almanac-hero__inner').map(({ body: declarations }) => /padding-block: var\(--space-(\w+)\) var\(--space-(\w+)\)/.exec(declarations));
  assert.equal(paddings.length, 2, 'the phone and the wide screen');
  for (const padding of paddings) {
    assert.ok(padding);
    assert.ok(space[padding[2]] >= 1.3 * space[padding[1]], `${padding[0]}: the foot is at least 1.3 times the head`);
  }
});

test('the shell fills the small viewport, the Menu wears the chevron, and the 404 title is Almanac\'s', () => {
  assert.match(body('.almanac'), /min-height: 100svh/);
  assert.match(read('src/themes/almanac/parts/Header.astro'), /<summary><span>\{copy\.menu\}<\/span><Icon name="down" \/><\/summary>/);
  assert.match(body('.almanac-header__mobile summary'), /list-style: none/);
  assert.match(body('.almanac-header__mobile summary::-webkit-details-marker'), /display: none/);
  // The shared 404 title is tracked tight for Google Sans; Almanac's titles are Trirong at 600, untracked.
  assert.match(body('.almanac .article-title'), /font-weight: 600; letter-spacing: 0/);
});

test('an empty category leads back to all posts, and a failed list offers to try again', () => {
  const home = read('src/themes/almanac/Home.astro');
  assert.match(home, /activeCategory \? <>\{copy\.noPostsInCategory\} <a href=\{home\}>\{copy\.allPosts\}<\/a><\/>/);
  assert.match(home, /\{copy\.postsUnavailable\} <a href=\{`\$\{Astro\.url\.pathname\}\$\{Astro\.url\.search\}`\}>\{tryAgain\}<\/a>/);
});

test("the missing page is titled at Almanac's post-title size, on the article's own column", () => {
  assert.match(body('.almanac .article-title'), /font-size: var\(--text-title\)/);
  const block = body('.almanac .notice-page');
  assert.match(block, /inline-size: min\(100% - 2 \* var\(--almanac-gutter\), 44em\)/);
  assert.match(block, /font-size: 1\.125rem/, 'the em of the article, so 44em is the same width');
  assert.match(block, /max-inline-size: none/);
  assert.match(block, /padding-inline: 0/);
});

test('on a category view a coverless card shows its tone alone, not the name the heading already says', () => {
  const home = read('src/themes/almanac/Home.astro');
  assert.match(home, /<PostCard [^>]*named=\{!activeCategory\}/);
  const card = read('src/themes/almanac/parts/PostCard.astro');
  assert.match(card, /\{named && <span>\{panel\.name\}<\/span>\}/);
  // A band with no name is decoration, and is not read inside the link.
  assert.match(card, /aria-hidden=\{named \? undefined : 'true'\}/);
});

test('on a touch screen a footer link is a box a finger can hit, as wide as it is tall, and never over the next line', () => {
  const coarse = within(/\(pointer: coarse\)/);
  const rule = (selector: string) => coarse.filter((candidate) => selectors(candidate).includes(selector)).map(({ body: declarations }) => declarations).join(';');
  for (const selector of ['.almanac-footer p a', '.almanac-footer__nav a']) {
    assert.match(rule(selector), /display: inline-flex/, selector);
    assert.match(rule(selector), /min-block-size: var\(--almanac-field\)/, selector);
    assert.doesNotMatch(rule(selector), /padding-block/, `${selector}: padding reached over the line above and below`);
  }
  assert.match(rule('.almanac-footer__nav a'), /min-inline-size: var\(--almanac-field\)/);
});

test("the article's cover says what its picture shows, not the title again", () => {
  const post = read('src/themes/almanac/Post.astro');
  assert.match(post, /<img class="almanac-article__cover" src=\{cover\} alt=\{coverAlt\} /);
  assert.doesNotMatch(post, /alt=\{post\.title\}/);
});
