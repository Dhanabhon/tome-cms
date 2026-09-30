import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { adminCopy } from '../../src/lib/admin-i18n';
import { ICONS } from '../../src/lib/icons';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const PAPER = read('src/themes/paper/theme.css');
const PLAIN = read('src/themes/plain/theme.css');
const GLOBAL = read('src/styles/global.css');

/** The declarations of the first unindented rule whose selector list is exactly `selector`. */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(match, `no rule for ${selector}`);
  return match[1];
}

test('a section break is three dots in the editor, in Paper and in Plain', () => {
  for (const [name, css, selector] of [
    ['the editor', GLOBAL, '.editor-content .ProseMirror hr'],
    ['Paper', PAPER, '.post-body hr'],
    ['Plain', PLAIN, '.plain-body hr'],
  ] as const) {
    const rule = ruleBody(css, selector);
    assert.match(rule, /border: 0/, `${name}: no line`);
    assert.match(rule, /margin-block: var\(--space-xl\)/, `${name}: room above and below`);
    assert.match(rule, /color: var\(--color-muted\)/, `${name}: muted`);
    assert.match(ruleBody(css, `${selector}::before`), /content: '\\2022\\2022\\2022'/, `${name}: three dots`);
  }
});

test('the block menu adds a new part, with the icon and the words for it', () => {
  assert.match(read('src/components/admin/BlockInsertMenu.tsx'), /\{ icon: 'part', label: copy\.blocks\.newPart, run: \(\) => editor\.chain\(\)\.focus\(\)\.setHorizontalRule\(\)\.run\(\) \}/);
  assert.ok(ICONS.part, 'no icon for part');
  assert.equal(adminCopy('en').blocks.newPart, 'New part');
  assert.equal(adminCopy('th').blocks.newPart, 'ส่วนใหม่');
});
