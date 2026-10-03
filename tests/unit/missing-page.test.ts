import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const PAGES = ['src/pages/[locale]/[slug].astro', 'src/pages/[locale]/blog/[slug].astro', 'src/pages/blog/[slug].astro'];

/** The declarations of `selector`'s first rule in `css`. */
const rule = (css: string, selector: string) => new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`, 'm').exec(css)?.[1] ?? '';

test('a missing page reads from the left, in the theme\'s face, at a post title\'s size', () => {
  for (const path of PAGES) {
    const source = read(path);
    const block = /<section class="notice-page[^"]*">[\s\S]*?<\/section>/.exec(source)?.[0] ?? '';
    assert.ok(block, `${path} draws the notice block`);
    // Not a centred stack under a shouted eyebrow: the theme's own column, read from its edge.
    assert.doesNotMatch(block, /text-center|uppercase|tracking-/, `${path} centres or shouts`);
    assert.match(block, /<p class="notice-status">\{loadError \? copy\.unavailable : '404'\}<\/p>/, path);
    assert.match(block, /<h1 class="article-title">/, `${path} titles it as a post is titled`);
    // The way back is a line of its own, under the title.
    assert.match(block, /<\/h1>\s*<p class="notice-back"><a href=/, path);
  }
  const css = read('src/styles/global.css');
  assert.match(rule(css, '.article-title'), /font-family: var\(--font-display\);/);
  assert.doesNotMatch(css, /\.notice-title\b/, 'the fixed 40px heading is gone');
  const status = rule(css, '.notice-status');
  assert.match(status, /color: var\(--color-muted\);/);
  assert.doesNotMatch(status, /text-transform|letter-spacing/);
  assert.match(rule(css, '.notice-back a'), /color: var\(--color-link\);/);
  // A hover only where there is one to have, and a press that shows.
  assert.match(css, /@media \(hover: hover\) \{\s*\.notice-back a:hover \{/);
  assert.match(css, /^\.notice-back a:active \{/m);
});
