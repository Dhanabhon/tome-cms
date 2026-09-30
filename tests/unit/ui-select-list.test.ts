import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
// Comments say what a rule is not, which would trip the checks that it is not there.
const CONTROLS = read('src/styles/ui-controls.css').replace(/\/\*[\s\S]*?\*\//g, '');
const GLOBAL = read('src/styles/global.css');

test('a list is as wide as its longest option, held between the trigger and the window, and never cuts one short', () => {
  assert.match(CONTROLS, /\.ui-select__menu \{[^}]*width: max-content/);
  assert.doesNotMatch(/\.ui-select__option > span:first-child \{([^}]*)\}/.exec(CONTROLS)?.[1] ?? '', /text-overflow|overflow: hidden/, 'an option wraps, it is not truncated');
  assert.doesNotMatch(CONTROLS, /\.ui-select__option \{[^}]*white-space: nowrap/);
  const select = read('src/components/admin/UiSelect.tsx');
  assert.match(select, /panelWidth: list\.offsetWidth, viewportWidth: window\.innerWidth/);
  assert.match(select, /list\.style\.minWidth = where\.minWidth === null/);
  assert.match(select, /list\.style\.maxWidth = where\.maxWidth === null/);
});

test('one row of a list is shaded: the active one, never the chosen one as well', () => {
  assert.match(CONTROLS, /\.ui-select__option\[data-active='true'\] \{\s*background: var\(--color-paper-3\);/);
  assert.doesNotMatch(CONTROLS, /aria-selected='true'\] \{\s*background/, 'the chosen row is marked by its check and weight');
  assert.doesNotMatch(CONTROLS, /\.ui-select__option:hover/, 'the pointer makes a row active; a second fill for hover would shade two');
});

test('the language filter is not a tab: its focus is a ring, not the accent line the current tab wears', () => {
  const rule = /\.admin-list-filter \.admin-list-filter__select:focus-visible \{([^}]*)\}/.exec(GLOBAL)?.[1] ?? '';
  assert.match(rule, /outline: 2px solid var\(--color-focus\)/);
  assert.doesNotMatch(rule, /border-block-end-color/);
});

test('the active option can be seen in forced-colors mode, where backgrounds are repainted', () => {
  assert.match(CONTROLS, /@media \(forced-colors: active\) \{\s*\.ui-select__option\[data-active='true'\] \{ outline: 2px solid Highlight; outline-offset: -2px; \}/);
});
