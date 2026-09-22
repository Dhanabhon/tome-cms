import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const CSS = readFileSync(new URL('../../src/styles/global.css', import.meta.url), 'utf8');

/** The declarations of the first unindented rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(CSS);
  assert.ok(match, `no rule for ${selector}`);
  return match[1];
}

test('a file card is a quiet surface every theme has, and its link no underlined word', () => {
  const card = rule('p.file-card > :is(a, .file-card__link)');
  assert.match(card, /border: var\(--rule-hair\) solid var\(--color-rule\);/);
  assert.match(card, /border-radius: var\(--radius-card\);/);
  assert.match(card, /text-decoration: none;/);
  assert.match(rule('p.file-card > a:hover'), /text-decoration: none;/, 'a theme that underlines links on hover does not reach it');
  assert.match(rule('p.file-card > a:focus-visible'), /outline: 2px solid var\(--color-focus\);/);
});
