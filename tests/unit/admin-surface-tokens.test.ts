import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const CSS = read('src/styles/global.css');
const TOKENS = read('src/styles/installer-tokens.css');

/** The declarations of the first unindented rule whose selector list is exactly `selector`. */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(match, `no rule for ${selector}`);
  return match[1];
}

function declaration(body: string, property: string): string | undefined {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[;{\\s])${escaped}\\s*:\\s*([^;]+);`).exec(body)?.[1]?.trim();
}

test('the admin takes rounder corners, shorter controls and a smaller title than the site', () => {
  const admin = ruleBody(CSS, '.admin-body');
  assert.equal(declaration(admin, '--radius-sm'), '0.5rem');
  assert.equal(declaration(admin, '--radius-input'), '0.625rem');
  // Restated, not inherited: on :root it is an alias resolved there, so overriding
  // --radius-input alone would leave cards at 8px.
  assert.equal(declaration(admin, '--radius-card'), '0.875rem');
  assert.equal(declaration(admin, '--control-height'), '2.5rem');
  assert.equal(declaration(admin, '--text-title'), '1.75rem');
});

test('a touch screen keeps a 44px control in the admin', () => {
  assert.match(CSS, /@media \(pointer: coarse\) \{\s*\.admin-body \{\s*--control-height: 2\.75rem;\s*\}\s*\}/);
});

test('the public site and the installer keep the root tokens', () => {
  const root = ruleBody(TOKENS, ':root');
  assert.equal(declaration(root, '--radius-sm'), '0.375rem');
  assert.equal(declaration(root, '--radius-input'), '0.5rem');
  assert.equal(declaration(root, '--radius-card'), 'var(--radius-input)');
  assert.equal(declaration(root, '--control-height'), '3rem');
  assert.equal(declaration(root, '--text-title'), 'clamp(1.75rem, 6vw, 2.5rem)');
});

test('an admin page title is semibold', () => {
  assert.equal(declaration(ruleBody(CSS, '.admin-page__head h1,\n.media-toolbar h1'), 'font-weight'), '600');
});

test('a tab count is the same badge as a sidebar count', () => {
  const tab = ruleBody(CSS, '.admin-tab-count');
  assert.equal(declaration(tab, 'border-radius'), 'var(--radius-pill)');
  assert.equal(declaration(tab, 'background'), 'var(--color-paper-3)');
  // Both badges count the same kind of thing, so they read at the same size.
  assert.equal(declaration(tab, 'font-size'), declaration(ruleBody(CSS, '.admin-nav-count'), 'font-size'));
});
