import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import { transform } from 'lightningcss';

test('a scroll-driven animation survives the production minifier', () => {
  // The minifier folds `animation` and `animation-timeline` into one shorthand. Chrome does not
  // accept a timeline inside the `animation` shorthand, drops the whole declaration, and the
  // reading progress bar and the fading hero sat still on every production site while passing
  // every test run against the dev server, which does not minify. Written as longhands, the
  // declarations stay apart.
  const files = [
    ...readdirSync(new URL('../../src/themes/', import.meta.url), { withFileTypes: true })
      .filter((entry) => entry.isDirectory()).map(({ name }) => `src/themes/${name}/theme.css`),
    'src/styles/global.css',
  ];
  let timelines = 0;
  for (const file of files) {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    timelines += (source.match(/animation-timeline/g) ?? []).length;
    const minified = transform({ filename: file, code: Buffer.from(source), minify: true }).code.toString();
    for (const [declaration] of minified.matchAll(/animation:[^;}]*/g)) {
      assert.doesNotMatch(declaration, /\b(scroll|view)\(/, `${file} minifies to "${declaration}", which Chrome drops`);
    }
  }
  assert.ok(timelines >= 2, 'the themes still have scroll-driven animations to check');
});

test('the reading rail keeps its grow, its transition and its reduced-motion rule through the minifier', () => {
  const file = 'src/themes/paper/theme.css';
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
  const minified = transform({ filename: file, code: Buffer.from(source), minify: true }).code.toString();
  const rules = [...minified.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector, body }));
  const rail = rules.filter(({ selector }) => selector.includes('reading-rail__link'));

  const current = rail.filter(({ selector }) => /aria-current/.test(selector) && /before/.test(selector));
  assert.ok(current.some(({ body }) => /transform:scaleX\(var\(--rail-grow\)\)/.test(body)), 'the current tick grows with transform: scaleX');
  assert.ok(current.some(({ body }) => /background:var\(--color-accent\)/.test(body)), 'the current tick is the accent colour');
  assert.ok(rail.some(({ selector, body }) => /before/.test(selector) && /transition:[^;]*transform/.test(body)), 'the tick transitions its transform');
  assert.ok(rail.some(({ selector, body }) => /data-passed/.test(selector) && /color-ink/.test(body)), 'passed ticks are ink');
  assert.ok(rail.some(({ body }) => /--rail-grow:/.test(body)), 'each level sets how far its tick grows');

  const reduced = minified.match(/@media[^{]*prefers-reduced-motion:\s*reduce[^{]*\{(?:[^{}]*\{[^{}]*\})*\}/g) ?? [];
  assert.ok(reduced.some((block) => /reading-rail__link/.test(block) && /transition:none/.test(block)), 'reduced motion switches the tick transition off');
});
