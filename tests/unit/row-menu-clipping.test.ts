import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const CSS = readFileSync(new URL('../../src/styles/global.css', import.meta.url), 'utf8');

/** The declarations of the first rule whose selector list is exactly `selector`. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(CSS);
  assert.ok(match, `no rule for ${selector}`);
  return match[1];
}

test('nothing that holds a row menu clips it', () => {
  // The post card and the page panel clipped their overflow to round their corners, and the
  // row menu is positioned inside them -- so publish, duplicate and delete opened past the
  // edge and could not be clicked. Only the cover image paints into a rounded corner; it
  // rounds itself instead.
  for (const container of ['.admin-story-grid .admin-story-row', '.admin-story-panel']) {
    assert.doesNotMatch(ruleBody(container), /overflow\s*:\s*(hidden|clip)/, `${container} must not clip the row menu`);
  }
});

test('the post cover rounds its own top corners', () => {
  const cover = ruleBody('.admin-story-grid .admin-story-cover');
  assert.match(cover, /border-start-start-radius/, 'with the card no longer clipping, the cover has to round itself');
  assert.match(cover, /border-start-end-radius/);
});
