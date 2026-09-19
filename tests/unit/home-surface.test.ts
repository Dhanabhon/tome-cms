import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const CSS = read('src/styles/global.css');
const HOME = read('src/pages/[locale]/index.astro');

/** The declarations of the first unindented rule whose selector list is exactly `selector`. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(CSS);
  assert.ok(match, `no rule for ${selector}`);
  return match[1];
}

test('the homepage opens with a page head, not a painted band', () => {
  // The band was the last block of utility classes on the page, and it was dark in both
  // themes -- which is why it carried a literal white that no token could reach.
  assert.doesNotMatch(HOME, /bg-hero/);
  assert.doesNotMatch(HOME, /text-white/);
  assert.match(HOME, /class="home-hero"/);
  const hero = ruleBody('.home-hero');
  assert.match(hero, /background: var\(--color-paper-2\)/);
  assert.match(hero, /border-block-end: var\(--rule-hair\) solid var\(--color-rule\)/);
});

test('a post card is a surface that does not clip its focus ring', () => {
  const card = ruleBody('.post-card');
  assert.match(card, /background: var\(--color-paper\)/);
  assert.match(card, /border: var\(--rule-hair\) solid var\(--color-rule\)/);
  assert.match(card, /border-radius: var\(--radius-lg\)/);
  // The title's link stretches over the card and rings itself 8px outside its own box.
  // A card that clips would cut that ring off, which is why the cover rounds its own corners.
  assert.doesNotMatch(card, /overflow\s*:\s*(hidden|clip)/);
  assert.match(ruleBody('.post-card__cover'), /border-start-start-radius/);
});

test('a chip is a ring when chosen, and the date wears a clock', () => {
  const chosen = ruleBody('.post-filter a[aria-current="page"]');
  assert.match(chosen, /border-color: var\(--color-accent\)/);
  assert.match(chosen, /color: var\(--color-link\)/);
  // The filled ink box is gone; both of these pairs are pinned in theme-contrast.test.ts.
  assert.doesNotMatch(chosen, /background: var\(--color-ink\)/);
  assert.match(HOME, /<Icon name="clock" \/>/);
  assert.match(HOME, /class="post-card__date"/);
});
