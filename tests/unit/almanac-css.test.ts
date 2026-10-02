import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { transform } from 'lightningcss';

/**
 * Almanac's stylesheet as production serves it: through the minifier Vite builds with. The dev
 * server does not minify, so a declaration the minifier folds into a form Chrome drops passes
 * every browser test and still sits dead on a live site -- which is how Paper's bar shipped.
 */
const FILE = 'src/themes/almanac/theme.css';
const minified = transform({
  code: readFileSync(new URL(`../../${FILE}`, import.meta.url)),
  filename: FILE,
  minify: true,
}).code.toString();

/** Every @media or @supports whose condition matches: the whole rule, and its body alone. */
function atRules(condition: RegExp): Array<{ body: string; rule: string }> {
  const found: Array<{ body: string; rule: string }> = [];
  for (const match of minified.matchAll(/@(?:media|supports)([^{]*)\{/g)) {
    if (!condition.test(match[1])) continue;
    const start = match.index + match[0].length;
    let depth = 1;
    let at = start;
    for (; depth > 0; at += 1) {
      if (minified[at] === '{') depth += 1;
      else if (minified[at] === '}') depth -= 1;
    }
    found.push({ body: minified.slice(start, at - 1), rule: minified.slice(match.index, at) });
  }
  return found;
}

const inside = (condition: RegExp) => atRules(condition).map(({ body }) => body).join('');

/** The stylesheet less those at-rules. */
const outside = (condition: RegExp) => atRules(condition).reduce((css, { rule }) => css.replace(rule, ''), minified);

test('the reading progress is drawn by the scroll, as longhands, only where a scroll timeline exists', () => {
  const supported = inside(/animation-timeline:\s*scroll\(\)/);
  assert.match(supported, /\.almanac-progress\{[^}]*animation-name:almanac-progress/, 'the bar names its keyframes');
  assert.match(supported, /\.almanac-progress\{[^}]*animation-timeline:scroll\(root/, 'the bar follows the page scroll');
  assert.match(supported, /@keyframes almanac-progress\{[^}]*transform:scaleX\(1\)/, 'the bar grows with transform alone');
  for (const [declaration] of minified.matchAll(/animation:[^;}]*/g)) {
    assert.doesNotMatch(declaration, /\b(scroll|view)\(/, `"${declaration}" is a shorthand Chrome drops`);
  }
  // Outside the guard there is no bar to draw: a browser with no timeline gets none, not a dead one.
  assert.doesNotMatch(outside(/animation-timeline/), /animation-timeline/);
});

test('a reader who asked for less motion is shown no progress bar', () => {
  const reduced = inside(/prefers-reduced-motion:\s*reduce/);
  assert.match(reduced, /\.almanac-progress\{display:none\}/);
});

test('everything Almanac moves, it moves by transform or opacity alone', () => {
  const moved = new Set<string>();
  for (const [, value] of minified.matchAll(/transition(?:-property)?:([^;}]+)/g)) {
    if (/^none\b/.test(value)) continue;
    for (const part of value.split(',')) moved.add(part.trim().split(/\s/)[0]);
  }
  assert.ok(moved.size > 0, 'the stylesheet still has transitions to check');
  assert.deepEqual([...moved].filter((property) => property !== 'transform' && property !== 'opacity'), []);

  for (const [, name, frames] of minified.matchAll(/@keyframes ([\w-]+)\{((?:[^{}]*\{[^{}]*\})*)\}/g)) {
    for (const [, property] of frames.matchAll(/([a-z-]+):/g)) {
      assert.ok(property === 'transform' || property === 'opacity', `@keyframes ${name} animates ${property}`);
    }
  }
});

test('the "More in" arrow moves only for a reader who has not asked for less motion', () => {
  const calm = inside(/prefers-reduced-motion:\s*no-preference/);
  assert.match(calm, /\.almanac-article__more[^{]*\{[^}]*transition:transform/);
  assert.doesNotMatch(outside(/prefers-reduced-motion:\s*no-preference/), /\.almanac-article__more[^{]*\{[^}]*transition/);
});
