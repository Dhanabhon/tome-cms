import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { transform } from 'lightningcss';

/**
 * A header sub-menu's arrival survives the production minifier, in both bundled themes.
 *
 * The dev server does not minify, so a declaration the minifier folds into something a browser
 * drops passes every browser test and still sits still on a real site -- which is what happened
 * to the scroll timelines (tests/unit/scroll-timeline-css.test.ts). This reads what the minifier
 * writes: the panel transitions opacity and transform, it starts from `@starting-style`, and a
 * reader who asked for less motion gets none.
 */
function minified(theme: string) {
  const file = `src/themes/${theme}/theme.css`;
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
  return transform({ filename: file, code: Buffer.from(source), minify: true }).code.toString();
}

const rules = (css: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector, body }));

for (const theme of ['paper', 'plain']) {
  test(`${theme}: the sub-menu panel keeps its transition and its starting style through the minifier`, () => {
    const css = minified(theme);
    const panel = rules(css).filter(({ selector }) => /\.site-submenu$/.test(selector.trim()));
    const moves = panel.find(({ body }) => /transition/.test(body));
    assert.ok(moves, 'the panel has a transition');
    // Longhands or one shorthand, either way opacity and transform move, and nothing else does.
    const properties = moves.body.match(/transition-property:([^;]*)/)?.[1]
      ?? [...moves.body.matchAll(/transition:([^;]*)/g)].map(([, value]) => value).join();
    assert.match(properties, /opacity/);
    assert.match(properties, /transform/);
    assert.doesNotMatch(properties, /\ball\b|width|height|inset|top|left/, 'only opacity and transform');
    assert.match(moves.body, /var\(--dur-short\)/, 'for as long as a menu takes to arrive');
    assert.match(moves.body, /opacity:1/, 'and it ends visible');

    const starting = css.match(/@starting-style\{((?:[^{}]*\{[^{}]*\})*)\}/g) ?? [];
    const from = starting.find((block) => /\[data-site-submenu\]\[open\]>\.site-submenu/.test(block));
    assert.ok(from, 'it arrives from a starting style while its sub-menu is open');
    assert.match(from, /opacity:0/);
    assert.match(from, /transform:translateY\(/, 'a few pixels up');
  });
}

test('the panel is still under reduced motion, in both themes', () => {
  const reduced = (css: string) => css.match(/@media[^{]*prefers-reduced-motion:\s*reduce[^{]*\{(?:[^{}]*\{[^{}]*\})*\}/g) ?? [];
  // Paper switches off every transition in its header at once; Plain names the panel itself.
  assert.ok(reduced(minified('paper')).some((block) => /\.site-header :not\(\[popover\]\)[^{]*\{[^}]*transition:none/.test(block)), 'paper');
  assert.ok(reduced(minified('plain')).some((block) => /\.site-submenu[^{]*\{[^}]*transition:none/.test(block)), 'plain');
});
