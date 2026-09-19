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
  // One selector, not two: the file library used to bring its own heading, and now stands
  // in the same page head as every other screen.
  assert.equal(declaration(ruleBody(CSS, '.admin-page__head h1'), 'font-weight'), '600');
});

test('a tab count is the same badge as a sidebar count', () => {
  const tab = ruleBody(CSS, '.admin-tab-count');
  assert.equal(declaration(tab, 'border-radius'), 'var(--radius-pill)');
  assert.equal(declaration(tab, 'background'), 'var(--color-paper-3)');
  // Both badges count the same kind of thing, so they read at the same size.
  assert.equal(declaration(tab, 'font-size'), declaration(ruleBody(CSS, '.admin-nav-count'), 'font-size'));
});

test('the search field is a shared wrapper, not a top bar detail', () => {
  const search = ruleBody(CSS, '.admin-search');
  assert.equal(declaration(search, 'position'), 'relative');
  // No display here: the top bar folds its own form away on a phone, and a display
  // declared on the shared class would outrank that rule from further up the file.
  assert.equal(declaration(search, 'display'), undefined);
  assert.match(CSS, /\.admin-search \.admin-control \{[^}]*padding-inline-start: 2\.5rem;/);
});

test('a card is a quiet surface and a control is not', () => {
  assert.match(declaration(ruleBody(CSS, '.admin-card'), 'border') ?? '', /var\(--color-rule\)$/);
  // Controls keep the strong rule: that is the pair pinned at 3:1.
  assert.match(declaration(ruleBody(CSS, '.admin-control'), 'border') ?? '', /var\(--color-rule-strong\)$/);
});

test('menus take the card corner and their items the small one', () => {
  assert.equal(declaration(ruleBody(CSS, '.admin-story-menu > div'), 'border-radius'), 'var(--radius-card)');
  assert.equal(declaration(ruleBody(CSS, '.admin-story-menu a,\n.admin-story-menu button'), 'border-radius'), 'var(--radius-sm)');
  assert.equal(declaration(ruleBody(CSS, '.admin-body .ui-select__menu'), 'border-radius'), 'var(--radius-card)');
  assert.equal(declaration(ruleBody(CSS, '.admin-body .ui-select__option'), 'border-radius'), 'var(--radius-sm)');
});

test('every admin dialog is the same surface', () => {
  for (const selector of ['.media-details', '.media-picker', '.navigation-dialog']) {
    const body = ruleBody(CSS, selector);
    assert.equal(declaration(body, 'border-radius'), 'var(--radius-lg)', selector);
    assert.match(declaration(body, 'border') ?? '', /var\(--color-rule\)$/, selector);
    assert.equal(declaration(body, 'background'), 'var(--color-paper)', selector);
  }
});

test("an empty state shows its screen's icon in a soft circle", () => {
  const mark = ruleBody(CSS, '.admin-empty__mark');
  assert.equal(declaration(mark, 'background'), 'var(--color-paper-3)');
  assert.equal(declaration(mark, 'border'), undefined, 'a filled circle needs no outline');
  assert.equal(declaration(mark, 'color'), 'var(--color-muted)');
  for (const [page, icon] of [['src/pages/admin/index.astro', 'posts'], ['src/pages/admin/pages/index.astro', 'pages']] as const) {
    assert.match(read(page), new RegExp(`admin-empty__mark[^>]*>\\s*<AdminIcon name="${icon}" />`), page);
  }
});

test('a status spaces itself with margin, now that its box is painted', () => {
  // On a narrow card the status carries the card's bottom spacing. As padding it was
  // invisible; on a pill it painted 12px of tint below the words.
  const narrow = /@container \(max-width: 24rem\) \{[\s\S]*?\n\}/.exec(CSS)?.[0] ?? '';
  assert.match(narrow, /\.admin-story-edition \.admin-status \{[^}]*margin-block-end/);
  assert.doesNotMatch(narrow, /\.admin-story-edition \.admin-status \{[^}]*padding-block/);
});

test('the list screens draw their marks instead of typing them', () => {
  for (const page of ['src/pages/admin/index.astro', 'src/pages/admin/pages/index.astro']) {
    const source = read(page);
    assert.doesNotMatch(source, /[⋯✎]/, `${page} still types a glyph as an icon`);
    assert.match(source, /<AdminIcon name="more" \/>/, `${page} has no row-menu icon`);
  }
  assert.match(read('src/pages/admin/index.astro'), /<AdminIcon name="clock" \/>/, 'the card has no clock');
});

test('the page list keeps its phone layout and takes columns on a wide screen', () => {
  assert.match(read('src/pages/admin/pages/index.astro'), /class="admin-page-head"/, 'the panel has no column header');
  // The stacked layout is what a phone gets, so the columns may only exist inside the query.
  const wide = /@media \(min-width: 48rem\) \{\s*\.admin-page-list[\s\S]*?\n\}/.exec(CSS)?.[0] ?? '';
  assert.match(wide, /--page-columns:/, 'the columns are not defined in the 48rem block');
  assert.match(wide, /\.admin-page-head \{[^}]*grid-template-columns: var\(--page-columns\)/);
  assert.doesNotMatch(CSS.replace(wide, ''), /\.admin-page-head \{[^}]*grid-template-columns/, 'a phone must not get the columns');
});

test('the file library stands in the same frame as every other screen', () => {
  const library = read('src/components/admin/MediaLibrary.tsx');
  assert.match(library, /className="admin-page__head"/, 'media has no admin page head');
  assert.match(library, /className="admin-search/, 'the media search is not the shared field');
  assert.match(library, /<AdminIcon name="search" \/>/, 'the media search has no magnifier');
  // The page frame belongs to the manage mode; the picker is a dialog and has no page.
  assert.match(library, /props\.mode === 'manage' && \(\s*<div className="admin-page__head">/, 'the frame is not conditional on the mode');
});

test('the media surfaces are tokens, not utility chains', () => {
  for (const selector of ['.media-card', '.media-empty', '.media-status', '.media-grid']) {
    assert.doesNotMatch(ruleBody(CSS, selector), /@apply/, `${selector} still borrows its look from utilities`);
  }
  assert.equal(declaration(ruleBody(CSS, '.media-card'), 'border-radius'), 'var(--radius-card)');
  // The empty state is the one the lists use, icon and all.
  const library = read('src/components/admin/MediaLibrary.tsx');
  assert.match(library, /className="admin-empty media-empty"/);
  assert.match(library, /<AdminIcon name="media" \/>/);
});

test('the details dialog uses the admin controls', () => {
  const library = read('src/components/admin/MediaLibrary.tsx');
  const dialog = library.slice(library.indexOf('className="media-details"'));
  for (const control of ['<textarea', '<input']) {
    const at = dialog.indexOf(control);
    assert.ok(at > -1, `the dialog has no ${control}`);
    assert.match(dialog.slice(at, at + 400), /className="admin-control/, `${control} is not an admin control`);
  }
  assert.match(dialog, /className="admin-button admin-button--primary"/, 'save is not the primary button');
  assert.match(dialog, /className="admin-button admin-button--danger"/, 'delete is not the danger button');
});
