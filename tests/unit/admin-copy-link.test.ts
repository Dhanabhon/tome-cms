import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { adminCopy } from '../../src/lib/admin-i18n';
import { isLive } from '../../src/lib/admin-story-list';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const LISTS = [
  ['src/pages/admin/index.astro', 'postPath', 'edition.id'],
  ['src/pages/admin/pages/index.astro', 'pagePath', 'edition.id'],
] as const;

test('an edition has a public address once it is published, and not while it is a draft or still to come', () => {
  const now = Date.parse('2026-10-01T12:00:00Z');
  assert.equal(isLive('published', '2026-09-30T12:00:00Z', now), true);
  assert.equal(isLive('draft', '2026-09-30T12:00:00Z', now), false, 'a draft has none');
  assert.equal(isLive('published', '2026-10-02T12:00:00Z', now), false, 'scheduled: the site does not answer yet');
  assert.equal(isLive('published', null, now), true);
});

test('both lists offer Copy link after Preview, for a published edition only, with the absolute address in the page', () => {
  for (const [path, helper] of LISTS) {
    const source = read(path);
    assert.match(source, /getPublicSiteUrl\(Astro\.request, Astro\.site\)/, `${path} knows the site's address`);
    const preview = source.indexOf('{copy.row.preview}</a>');
    const item = source.indexOf('data-copy-link={');
    const duplicate = source.indexOf('data-post-action="duplicate"') > 0 ? source.indexOf('data-post-action="duplicate"') : source.indexOf('data-page-action="duplicate"');
    assert.ok(preview > 0 && item > preview && item < duplicate, `${path}: Copy link sits between Preview and Duplicate`);
    assert.match(source, new RegExp(`data-copy-link=\\{new URL\\(${helper}\\(edition\\), siteUrl\\)\\.href\\}`), `${path} writes the absolute address`);
    assert.match(source, /hidden=\{!isLive\(edition\.status, edition\.published_at\)\}/, `${path} hides it until there is one`);
    assert.match(source, /data-copy-link-manual=\{copy\.row\.copyLinkManual\}/, `${path} hands the script its fallback words`);
    assert.match(source, /role="status" data-copy-status/, `${path} has a status region outside the menu`);
  }
});

test('the list script copies, says so for a moment, closes the menu, and falls back to a field to copy by hand', () => {
  const script = read('src/lib/admin-story-list.ts');
  assert.match(script, /closest<HTMLButtonElement>\('button\[data-copy-link\]'\)/);
  assert.match(script, /navigator\.clipboard\.writeText\(/);
  assert.match(script, /readOnly: true/, 'no clipboard: the address is shown, selected, in the in-house dialog');
  assert.match(script, /menu\.open = false/);
  // Publishing or unpublishing in place changes whether there is an address to copy.
  assert.match(script, /copyLink\.hidden = !isLive\(record\.status, record\.published_at\)/);
});

test('the dialog can show an address that is only to be read, with one button to leave by', () => {
  const dialog = read('src/lib/ui-dialog.ts');
  assert.match(dialog, /readOnly\?: boolean/);
  assert.match(dialog, /input\.readOnly = true/);
  assert.match(dialog, /input\?\.select\(\)/);
});

test('the row menu says Copy link in both languages, and its item swaps its words without changing its width', () => {
  assert.equal(adminCopy('en').row.copyLink, 'Copy link');
  assert.equal(adminCopy('th').row.copyLink, 'คัดลอกลิงก์');
  assert.equal(adminCopy('en').row.copyLinkManual.length > 0, true);
  assert.notEqual(adminCopy('th').row.copyLinkManual, adminCopy('en').row.copyLinkManual);
  const css = read('src/styles/global.css');
  assert.match(css, /\.admin-story-menu button\[data-copy-link\] \{ display: grid; \}/);
  assert.match(css, /\.admin-story-menu button\[data-copy-link\]\[hidden\] \{ display: none; \}/);
});
