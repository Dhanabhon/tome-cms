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

test('a tab count adds only what a tab needs', () => {
  // It is the shared badge, so its own rule may only carry the two things a tab changes:
  // tighter sides, and no more weight than the label beside it. Matched as written rather
  // than through ruleBody, which would find the shared rule this selector also ends.
  assert.match(CSS, /\n\.admin-tab-count \{ padding-inline: var\(--space-2xs\); font-weight: 400; \}/);
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

test('every set of tabs in the admin is drawn the same way', () => {
  // Posts and Pages tab with links; the menu editor tabs with real ARIA tabs. Different
  // elements, one look -- otherwise the same control is two controls on two screens.
  const tabs = ruleBody(CSS, '.admin-post-tabs,\n.navigation-tabs');
  assert.match(tabs, /border-block-end: var\(--rule-hair\) solid var\(--color-rule\)/);
  const item = ruleBody(CSS, '.admin-post-tabs a,\n.navigation-tabs [role="tab"]');
  assert.equal(declaration(item, 'min-height'), 'var(--control-height)');
  assert.match(read('src/components/admin/NavigationManager.tsx'), /className="navigation-tab"/, 'the tabs are still admin-buttons');
});

test('a menu item is handled with icons that keep their words', () => {
  const manager = read('src/components/admin/NavigationManager.tsx');
  assert.doesNotMatch(manager, /⠿/, 'the grip is still a typed character');
  for (const name of ['grip', 'up', 'down', 'trash']) {
    assert.match(manager, new RegExp(`<AdminIcon name="${name}" />`), `no ${name} icon`);
  }
  // An icon button says what it does to anyone who cannot see it.
  for (const label of ['moveUp', 'moveDown', 'remove']) {
    assert.match(manager, new RegExp(`aria-label=\\{copy\\.navigation\\.${label}\\}`), `${label} lost its label`);
    assert.match(manager, new RegExp(`title=\\{copy\\.navigation\\.${label}\\}`), `${label} lost its title`);
  }
  assert.match(manager, /className="admin-empty navigation-empty"/, 'the empty menu is not the shared empty state');
});

test('a count is one badge, wherever it is counted', () => {
  const badge = ruleBody(CSS, '.admin-count,\n.admin-nav-count,\n.admin-tab-count');
  assert.equal(declaration(badge, 'border-radius'), 'var(--radius-pill)');
  assert.equal(declaration(badge, 'background'), 'var(--color-paper-3)');
  // The number is shown; the sentence it came from stays as the label.
  const manager = read('src/components/admin/CategoryManager.tsx');
  assert.match(manager, /className="admin-count"/, 'the category count is not a badge');
  assert.match(manager, /aria-label=\{postCountLabel\(copy, category\.postCount\)\}/, 'the count lost its words');
});

test('a category row is handled with icons that keep their words', () => {
  const manager = read('src/components/admin/CategoryManager.tsx');
  for (const name of ['pencil', 'trash']) {
    assert.match(manager, new RegExp(`<AdminIcon name="${name}" />`), `no ${name} icon`);
  }
  for (const label of ['renameLabelFor', 'deleteLabelFor']) {
    assert.match(manager, new RegExp(`title=\\{fill\\(copy\\.categories\\.${label}`), `${label} lost its title`);
  }
});

test('a passkey and an avatar are handled with the same icons as every other row', () => {
  const security = read('src/components/admin/SecurityManager.tsx');
  for (const name of ['pencil', 'trash']) {
    assert.match(security, new RegExp(`<AdminIcon name="${name}" />`), `security has no ${name} icon`);
  }
  for (const label of ['renameLabelFor', 'deleteLabelFor']) {
    assert.match(security, new RegExp(`title=\\{fill\\(copy\\.security\\.${label}`), `${label} lost its title`);
  }
  // The avatar's remove is the same shape, and says what it removes.
  const profile = read('src/components/admin/ProfileForm.tsx');
  assert.match(profile, /<AdminIcon name="trash" \/>/, 'the avatar remove is not an icon button');
  assert.match(profile, /aria-label=\{copy\.profile\.removeAvatar\}/, 'the avatar remove has no label');
  // The panels inside a card take the card's corner, not a control's.
  for (const selector of ['.security-add', '.security-codes']) {
    assert.equal(declaration(ruleBody(CSS, selector), 'border-radius'), 'var(--radius-card)', selector);
  }
});

test('a settings drawer closes and removes the way every panel does', () => {
  for (const drawer of ['PostSettingsDrawer', 'PageSettingsDrawer']) {
    const source = read(`src/components/admin/${drawer}.tsx`);
    assert.match(source, /className="admin-button admin-button--ghost admin-button--icon"[\s\S]{0,200}<AdminIcon name="close" \/>/, `${drawer} does not close with the close icon`);
    assert.match(source, /aria-label=\{copy\.drawer\.closeSettings\}/, `${drawer} lost its close label`);
  }
  // The cover's remove is the bin the avatar and the passkey use.
  const post = read('src/components/admin/PostSettingsDrawer.tsx');
  assert.match(post, /<AdminIcon name="trash" \/>/, 'the cover remove is not an icon button');
  assert.match(post, /aria-label=\{copy\.drawer\.removeCover\}/, 'the cover remove has no label');
});

test('the insert menu is the same menu as the others', () => {
  assert.equal(declaration(ruleBody(CSS, '.block-insert-menu'), 'border-radius'), 'var(--radius-card)');
  assert.equal(declaration(ruleBody(CSS, '.block-insert-menu'), 'padding'), 'var(--space-2xs)');
  const item = ruleBody(CSS, '.block-insert-item');
  assert.equal(declaration(item, 'border-radius'), 'var(--radius-sm)');
  assert.equal(declaration(item, 'padding'), 'var(--space-xs) var(--space-sm)');
  assert.match(ruleBody(CSS, '.block-insert-item:hover,\n.block-insert-item:focus'), /var\(--color-paper-3\)/);
  // The editor's last utility chain.
  assert.doesNotMatch(read('src/components/admin/Editor.tsx'), /className="mb-6 flex/);
});

test('every island in the admin shows something while it loads', () => {
  // PasskeySignIn was the only client:only island with no fallback, so the panel that
  // asks for a passkey was blank until React arrived.
  for (const page of ['src/pages/admin/index.astro', 'src/pages/admin/security.astro']) {
    const source = read(page);
    for (const [, island] of source.matchAll(/<(\w+)[^>]*client:only/g)) {
      assert.match(source, new RegExp(`<${island}[\\s\\S]{0,600}?slot="fallback"`), `${page}: ${island} has no fallback`);
    }
  }
  // The stage is a card, so it takes a card's hairline.
  assert.match(declaration(ruleBody(CSS, '.admin-auth-stage'), 'border') ?? '', /var\(--color-rule\)$/);
});

test('a checkbox rings itself, not the paragraph beside it', () => {
  // :focus-within on the block framed the label and its hint on a plain mouse click.
  assert.doesNotMatch(CSS, /\.admin-check:focus-within/);
  assert.match(CSS, /\.admin-check input:focus-visible \{[^}]*outline: 2px solid var\(--color-focus\)/);
});

test('the picker closes from its toolbar, not from a button floating over its corner', () => {
  // The cancel was sticky + float-right, so it landed on top of the upload button once the
  // toolbar became a row. The library places it instead, at the end of that row.
  assert.doesNotMatch(read('src/components/admin/MediaPicker.tsx'), /media-picker-cancel/);
  assert.doesNotMatch(CSS, /\.media-picker-cancel/);
  const library = read('src/components/admin/MediaLibrary.tsx');
  assert.match(library, /className="media-toolbar__end"/);
  assert.match(library, /props\.mode === 'select' && <button autoFocus aria-label=\{copy\.media\.cancel\}/);
});

test('a busy control says so in the attribute a screen reader reads', () => {
  // aria-busy, not data-state: one attribute for the spinner and for the announcement,
  // and the one .admin-control already uses.
  assert.doesNotMatch(CSS, /\.admin-button\[data-state="loading"\]/);
  assert.match(CSS, /\.admin-button\[aria-busy="true"\]::before \{/);
  // A reader who asked for less motion keeps the ring, closed, and loses the spin. The
  // admin already had this fallback; the installer, which draws its own spinner from its
  // own keyframes, had none.
  assert.match(CSS, /\.admin-button\[aria-busy="true"\]::before \{ animation: none; border-block-start-color: currentColor; \}/);
  const installer = read('src/styles/installer.css');
  assert.doesNotMatch(installer, /\.installer-button\[data-state="loading"\]/);
  assert.match(installer, /\.installer-button\[aria-busy="true"\]::before \{ animation: none;/);
  // The four controls that already reported loading move with it.
  for (const component of ['Editor', 'PageEditor', 'NavigationManager', 'InstallerWizard']) {
    assert.doesNotMatch(read(`src/components/admin/${component}.tsx`), /data-state=\{[^}]*'loading'/, `${component} still reports loading through data-state`);
  }
});

test('every control that starts a request reports it', () => {
  // Named rather than inferred: a button disabled while something else works is not busy,
  // and only the control that was pressed may say it is.
  const controls: ReadonlyArray<readonly [string, string]> = [
    ['SettingsForm', 'saving'],
    ['ProfileForm', 'saving'],
    ['CategoryManager', "pendingActionIds.has('create')"],
    ['SecurityManager', 'busy'],
    ['MediaLibrary', 'uploading'],
    ['PasskeySignIn', 'busy'],
  ];
  for (const [component, flag] of controls) {
    const source = read(`src/components/admin/${component}.tsx`);
    assert.ok(source.includes(`aria-busy={${flag}}`), `${component} has no control reporting ${flag}`);
  }
  // The words move to the status line, so a button keeps its width.
  const settings = read('src/components/admin/SettingsForm.tsx');
  assert.doesNotMatch(settings, /\{saving \? copy\.settings\.saving : copy\.settings\.save\}/);
  assert.match(settings, /role="status">\{saving \? copy\.settings\.saving/);
});
