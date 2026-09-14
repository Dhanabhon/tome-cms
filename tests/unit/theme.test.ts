import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { normalizeTheme, THEME_CHOICES, themeAttribute } from '../../src/lib/theme';

const CSS = readFileSync(new URL('../../src/styles/installer-tokens.css', import.meta.url), 'utf8');

test('system means no attribute, so the reader\'s own setting decides', () => {
  // The stylesheet keys the system state on the attribute being absent. Rendering
  // data-theme="system" would happen to work today, because no rule matches it and
  // the media query still applies -- and would stop working the moment anyone wrote
  // a selector on [data-theme] alone.
  assert.equal(themeAttribute('system'), null);
  assert.equal(themeAttribute('light'), 'light');
  assert.equal(themeAttribute('dark'), 'dark');
});

test('an unrecognised stored value falls back to the reader\'s setting', () => {
  for (const junk of [undefined, null, '', 'System', 'DARK', 'sepia', 0, {}, ['dark']]) {
    assert.equal(normalizeTheme(junk), 'system', `${JSON.stringify(junk)} is not a theme`);
  }
  for (const choice of THEME_CHOICES) assert.equal(normalizeTheme(choice), choice);
});

test('every attribute this can render has a rule in the stylesheet', () => {
  // The TypeScript and the CSS have to agree on the exact attribute values. Nothing
  // else connects them: a rename on either side is silent, and the page simply keeps
  // rendering in the wrong theme.
  for (const choice of THEME_CHOICES) {
    const attribute = themeAttribute(choice);
    if (attribute === null) continue;
    assert.ok(
      CSS.includes(`[data-theme='${attribute}']`),
      `the stylesheet has no rule for data-theme='${attribute}'`,
    );
  }
  assert.ok(!CSS.includes("[data-theme='system']"), 'system must stay the absence of the attribute, not a value');
});
