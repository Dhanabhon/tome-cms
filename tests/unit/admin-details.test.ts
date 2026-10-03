import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import { cssRules } from '../helpers/css';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const PUBLIC = /\.site-notice|\.site-popup|\.file-card|\.tome-video|\.notice-|\.article-title/;
const RULES = ['global.css', 'stats.css']
  .flatMap((file) => cssRules(read(`src/styles/${file}`)))
  .filter(({ selector }) => !PUBLIC.test(selector));

/** The value of `property` in a rule body, or undefined. */
const value = (body: string, property: string) => new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;]+);`).exec(body)?.[1]?.trim();
/** The rules that name `selector` in their selector list, at any nesting. */
const naming = (selector: string) => RULES.filter((rule) => rule.selector.split(',').some((part) => part.trim() === selector));

test('no admin notice or report bar wears a stripe down its side; a quotation may', () => {
  const striped = RULES.filter(({ body }) => /border-inline-start:\s*\d+px/.test(body)).map(({ selector }) => selector);
  assert.deepEqual(striped, ['.drawer-suggestion blockquote']);
  for (const selector of ['.home-slides-notice', '.ai-undo']) {
    assert.match(value(naming(selector)[0]!.body, 'border-block-end') ?? '', /var\(--rule-hair\) solid var\(--color-rule\)/, selector);
  }
});

test('an invalid field keeps its red tint under the pointer', () => {
  const hovers = RULES.filter(({ context, selector }) => context.some((at) => at.includes('(hover: hover)')) && selector.includes('.admin-control'));
  assert.ok(hovers.length > 0);
  for (const { selector } of hovers) {
    for (const part of selector.split(',').filter((entry) => entry.includes('.admin-control:'))) {
      assert.match(part, /:not\(\[aria-invalid="true"\]\)/, part);
    }
  }
});

test('headings that can carry a Thai title drop their negative tracking, and the titles say their language', () => {
  const reset = RULES.find(({ selector, body }) => selector.includes(':lang(th)') && selector.includes('.admin-story-content h2') && /letter-spacing:\s*0/.test(body));
  assert.ok(reset, 'no Thai reset for the story titles');
  // On the element itself, so a Thai title in an English admin is reached by its own lang.
  assert.match(reset.selector, /\):lang\(th\)$/);
  for (const name of ['.admin-story-content h2', '.category-row h2', '.theme-card__name', '.plugin-card__name strong', '.admin-card h2']) {
    assert.ok(reset.selector.includes(name), name);
  }
  assert.ok(RULES.some(({ selector, body }) => selector.includes('.stats-articles tbody th') && selector.includes(':lang(th)') && /letter-spacing:\s*0/.test(body)), 'stats titles');
  for (const page of ['src/pages/admin/index.astro', 'src/pages/admin/pages/index.astro']) {
    assert.match(read(page), /class="admin-story-edition__title" lang=\{edition\.locale\}/, page);
  }
  assert.match(read('src/pages/admin/stats.astro'), /<th lang=\{article\.title \? article\.locale : undefined\} scope="row">/);
});

test('below the wrap, the tab row carries its own rule, so the current tab sits on it', () => {
  const narrow = RULES.filter(({ context }) => context.some((at) => at.includes('max-width: 39.999rem')));
  for (const tabs of ['.stats-segments', '.admin-list-bar .admin-post-tabs']) {
    const rule = narrow.find(({ selector }) => selector.split(',').some((part) => part.trim() === tabs));
    assert.ok(rule, tabs);
    assert.match(value(rule.body, 'border-block-end') ?? '', /var\(--rule-hair\) solid var\(--color-rule\)/, tabs);
  }
  for (const bar of ['.stats-filters', '.admin-list-bar']) {
    const rule = narrow.find(({ selector }) => selector.split(',').some((part) => part.trim() === bar));
    assert.equal(value(rule?.body ?? '', 'border-block-end'), '0', bar);
  }
});

test('prose keeps its measure, and the maintenance templates sit two by two', () => {
  assert.equal(value(naming('.redirect-add p')[0]!.body, 'max-width'), '40rem');
  assert.equal(value(naming('.maintenance-templates')[0]!.body, 'grid-template-columns'), 'repeat(2, minmax(0, 1fr))');
});

test('tabs, sidebar links and folder chips answer a press', () => {
  const pressed = RULES.filter(({ selector }) => selector.includes(':active')).flatMap(({ selector }) => selector.split(',').map((part) => part.trim()));
  for (const control of ['.admin-post-tabs a', '.navigation-tabs [role="tab"]', '.stats-segments a', '.admin-sidebar nav a', '.admin-mobile-nav nav a', '.media-category']) {
    assert.ok(pressed.some((selector) => selector.startsWith(`${control}:active`)), control);
  }
});

test('the admin draws arrows and ticks from the icon set, not as text', () => {
  const files = ['src/components/admin', 'src/pages/admin'].flatMap((dir) => readdirSync(new URL(`../../${dir}`, import.meta.url), { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.(astro|tsx)$/.test(file) && !file.includes('InstallerWizard'))
    .map((file) => `${dir}/${file}`));
  for (const file of files) assert.doesNotMatch(read(file), /[←→↗✓]/, file);
});

test('the Themes note links its guide instead of printing the address', () => {
  const copy = read('src/lib/admin-i18n.ts');
  assert.doesNotMatch(copy, /sourceBody: '[^']*https?:/);
  assert.match(read('src/components/admin/ThemeForm.tsx'), /copy\.theme\.sourceLink/);
});
