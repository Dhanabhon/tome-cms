import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
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

test('the admin takes its own corners, controls, title and rhythm on top of the root tokens', () => {
  const admin = ruleBody(CSS, '.admin-body');
  assert.equal(declaration(admin, '--radius-sm'), '0.5rem');
  assert.equal(declaration(admin, '--radius-input'), '0.625rem');
  // 8px, not 14: a card frames a cover or a preview, and reads as a page element, not a widget.
  assert.equal(declaration(admin, '--radius-card'), '0.5rem');
  assert.equal(declaration(admin, '--control-height'), '2.5rem');
  // The display size: the title is the masthead now that there is no top bar.
  assert.equal(declaration(admin, '--text-title'), 'var(--text-2xl)');
  // The 32px step the root scale lacks; global.css used to write 2rem by hand for it.
  assert.equal(declaration(admin, '--space-xl'), '2rem');
  assert.equal(declaration(admin, '--admin-topbar-height'), '3.5rem');
  assert.equal(declaration(admin, 'font-variant-numeric'), 'tabular-nums');
});

test('running text keeps proportional figures', () => {
  assert.match(CSS, /\.editor-content \{ font-variant-numeric: normal; \}/);
  // The card title's own rule carries it now, so its rule is the one `ruleBody` finds first.
  assert.equal(declaration(ruleBody(CSS, '.admin-story-content h2'), 'font-variant-numeric'), 'normal');
});

test('the admin writes its 32px step as a token, not by hand', () => {
  // The two the sweep is certain of; the rest is `grep -n 2rem` in Step 4.
  assert.match(declaration(ruleBody(CSS, '.admin-mobile-nav'), 'width') ?? '', /calc\(100% - var\(--space-xl\)\)/);
  assert.equal(declaration(ruleBody(CSS, '.admin-check input'), 'margin-block-start'), 'var(--space-3xs)');
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

test('a tab count adds only what a tab needs', () => {
  // a count is the shared figure and adds nothing of its own
  // (the shared rule ends in this selector, so a comma precedes it there)
  assert.doesNotMatch(CSS, /[^,]\n\.admin-tab-count \{/);
});

test('the search field is a shared wrapper, not a top bar detail', () => {
  const search = ruleBody(CSS, '.admin-search');
  assert.equal(declaration(search, 'position'), 'relative');
  // No display here: the top bar folds its own form away on a phone, and a display
  // declared on the shared class would outrank that rule from further up the file.
  assert.equal(declaration(search, 'display'), undefined);
  assert.match(CSS, /\.admin-search \.admin-control \{[^}]*padding-inline-start: 2\.5rem;/);
});

test('a control keeps the strong rule a sheet no longer has', () => {
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
  for (const selector of ['.media-details', '.media-picker', '.media-upload-dialog', '.navigation-dialog']) {
    const body = ruleBody(CSS, selector);
    assert.equal(declaration(body, 'border-radius'), 'var(--radius-lg)', selector);
    assert.match(declaration(body, 'border') ?? '', /var\(--color-rule\)$/, selector);
    assert.equal(declaration(body, 'background'), 'var(--color-paper)', selector);
  }
});

test('an empty state is one of three tiers, and none of them has an icon or a dashed box', () => {
  assert.doesNotMatch(CSS, /\.admin-empty__mark/, 'the icon circle is still drawn');
  for (const gone of ['.admin-empty-inline', '.redirect-empty', '.navigation-empty', '.media-empty', '.stats-empty {']) {
    assert.ok(!CSS.includes(`\n${gone}`) && !read('src/styles/stats.css').includes(`\n${gone}`), `${gone} still exists`);
  }
  const first = ruleBody(CSS, '.admin-empty');
  assert.equal(declaration(first, 'border-block-start'), 'var(--rule-hair) solid var(--color-rule)');
  assert.equal(declaration(first, 'max-width'), '36rem');
  assert.equal(declaration(ruleBody(CSS, '.admin-empty h2'), 'font-family'), 'var(--font-display)');
  assert.doesNotMatch(CSS, /\.admin-story-list > \.admin-empty \{[^}]*dashed/);
  // The screens: which tier each one draws.
  assert.match(read('src/pages/admin/index.astro'), /posts\.length \? \(\s*<p class="admin-empty admin-empty--filtered">/);
  assert.match(read('src/pages/admin/pages/index.astro'), /pages\.length \? \(\s*<p class="admin-empty admin-empty--filtered">/);
  assert.match(read('src/components/admin/ProfileForm.tsx'), /className="admin-empty admin-empty--inline"/);
  assert.match(read('src/components/admin/RedirectManager.tsx'), /className="admin-empty admin-empty--inline"/);
  for (const file of ['src/components/admin/MediaLibrary.tsx', 'src/components/admin/NavigationManager.tsx', 'src/components/admin/SlidesManager.tsx', 'src/pages/admin/stats.astro']) {
    assert.match(read(file), /class(?:Name)?="admin-empty"[\s\S]{0,80}?class(?:Name)?="admin-eyebrow"/, `${file} is not a tier-1 empty`);
  }
});

test('a status spaces itself with margin, for rhythm', () => {
  // On a narrow card the status carries the card's bottom spacing. Its pill is gone, so the
  // margin is only there to keep the card's rhythm; as padding it was still the wrong tool.
  const narrow = /@container \(max-width: 24rem\) \{[\s\S]*?\n\}/.exec(CSS)?.[0] ?? '';
  assert.match(narrow, /\.admin-story-edition \.admin-status \{[^}]*margin-block-end/);
  assert.doesNotMatch(narrow, /\.admin-story-edition \.admin-status \{[^}]*padding-block/);
});

test('the list screens draw their marks instead of typing them', () => {
  for (const page of ['src/pages/admin/index.astro', 'src/pages/admin/pages/index.astro']) {
    const source = read(page);
    assert.doesNotMatch(source, /[⋯✎]/, `${page} still types a glyph as an icon`);
    assert.match(source, /<Icon name="more" \/>/, `${page} has no row-menu icon`);
  }
  assert.match(read('src/pages/admin/index.astro'), /<Icon name="clock" \/>/, 'the card has no clock');
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
  assert.match(library, /<Icon name="search" \/>/, 'the media search has no magnifier');
  // The page frame belongs to the manage mode; the picker is a dialog and has no page.
  assert.match(library, /props\.mode === 'manage' && \(\s*<div className="admin-page__head">/, 'the frame is not conditional on the mode');
});

test('the media surfaces are tokens, not utility chains', () => {
  for (const selector of ['.media-card', '.media-status', '.media-grid']) {
    assert.doesNotMatch(ruleBody(CSS, selector), /@apply/, `${selector} still borrows its look from utilities`);
  }
  assert.equal(declaration(ruleBody(CSS, '.media-card'), 'border-radius'), 'var(--radius-card)');
  // The empty state is the one the lists use.
  const library = read('src/components/admin/MediaLibrary.tsx');
  assert.match(library, /className="admin-empty"/);
});

test('the details dialog uses the admin controls', () => {
  const library = read('src/components/admin/MediaLibrary.tsx');
  const dialog = library.slice(library.indexOf('className="media-details"'));
  for (const control of ['<textarea', '<input']) {
    const at = dialog.indexOf(control);
    assert.ok(at > -1, `the dialog has no ${control}`);
    assert.match(dialog.slice(at, at + 400), /className="admin-control/, `${control} is not an admin control`);
  }
  // SaveButton draws the primary button itself.
  assert.match(dialog, /<SaveButton/, 'save is not the shared save button');
  assert.match(read('src/components/admin/SaveButton.tsx'), /className="admin-button admin-button--primary admin-save-button"/, 'save is not the primary button');
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
    assert.match(manager, new RegExp(`<Icon name="${name}" />`), `no ${name} icon`);
  }
  // An icon button says what it does to anyone who cannot see it.
  for (const label of ['moveUp', 'moveDown', 'remove']) {
    assert.match(manager, new RegExp(`aria-label=\\{copy\\.navigation\\.${label}\\}`), `${label} lost its label`);
    assert.match(manager, new RegExp(`title=\\{copy\\.navigation\\.${label}\\}`), `${label} lost its title`);
  }
  assert.match(manager, /className="admin-empty"/, 'the empty menu is not the shared empty state');
});

test('a count is one badge, wherever it is counted', () => {
  const badge = ruleBody(CSS, '.admin-count,\n.admin-nav-count,\n.admin-tab-count');
  assert.equal(declaration(badge, 'border-radius'), undefined);
  assert.equal(declaration(badge, 'background'), undefined);
  // The number is shown; the sentence it came from stays as the label.
  const manager = read('src/components/admin/CategoryManager.tsx');
  assert.match(manager, /className="admin-count"/, 'the category count is not a badge');
  assert.match(manager, /aria-label=\{postCountLabel\(copy, category\.postCount\)\}/, 'the count lost its words');
});

test('a category row is handled with icons that keep their words', () => {
  const manager = read('src/components/admin/CategoryManager.tsx');
  for (const name of ['pencil', 'trash']) {
    assert.match(manager, new RegExp(`<Icon name="${name}" />`), `no ${name} icon`);
  }
  for (const label of ['renameLabelFor', 'deleteLabelFor']) {
    assert.match(manager, new RegExp(`title=\\{fill\\(copy\\.categories\\.${label}`), `${label} lost its title`);
  }
});

test('a passkey and an avatar are handled with the same icons as every other row', () => {
  const security = read('src/components/admin/SecurityManager.tsx');
  for (const name of ['pencil', 'trash']) {
    assert.match(security, new RegExp(`<Icon name="${name}" />`), `security has no ${name} icon`);
  }
  for (const label of ['renameLabelFor', 'deleteLabelFor']) {
    assert.match(security, new RegExp(`title=\\{fill\\(copy\\.security\\.${label}`), `${label} lost its title`);
  }
  // The avatar's remove is the same shape, and says what it removes.
  const profile = read('src/components/admin/ProfileForm.tsx');
  assert.match(profile, /<Icon name="trash" \/>/, 'the avatar remove is not an icon button');
  assert.match(profile, /aria-label=\{copy\.profile\.removeAvatar\}/, 'the avatar remove has no label');
  // The panels inside a card are plain now: a card is a sheet with no box, so a box inside
  // it would be the only rounded thing on the screen.
  for (const selector of ['.security-add', '.security-codes']) {
    assert.equal(declaration(ruleBody(CSS, selector), 'border-radius'), undefined, selector);
  }
});

test('a settings drawer closes and removes the way every panel does', () => {
  for (const drawer of ['PostSettingsDrawer', 'PageSettingsDrawer']) {
    const source = read(`src/components/admin/${drawer}.tsx`);
    assert.match(source, /className="admin-button admin-button--ghost admin-button--icon"[\s\S]{0,200}<Icon name="close" \/>/, `${drawer} does not close with the close icon`);
    assert.match(source, /aria-label=\{copy\.drawer\.closeSettings\}/, `${drawer} lost its close label`);
  }
  // The cover's remove is the bin the avatar and the passkey use.
  const post = read('src/components/admin/PostSettingsDrawer.tsx');
  assert.match(post, /<Icon name="trash" \/>/, 'the cover remove is not an icon button');
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
  // On top of the label, not beside it: a button that grows by a spinner's width still
  // moves everything after it at exactly the moment the reader is waiting on it.
  assert.match(ruleBody(CSS, '.admin-button[aria-busy="true"]::before'), /position: absolute/);
  assert.match(ruleBody(CSS, '.admin-button[aria-busy="true"]'), /color: transparent/);
  // A reader who asked for less motion keeps the ring, closed, and loses the spin. The
  // admin already had this fallback; the installer, which draws its own spinner from its
  // own keyframes, had none.
  assert.match(CSS, /\.admin-button\[aria-busy="true"\]::before \{ animation: none; border-block-start-color: var\(--admin-busy-ring, var\(--color-ink\)\); \}/);
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
    ['ThemeForm', 'busy === id'],
    ['PluginManager', 'busy'],
    ['CategoryManager', "pendingActionIds.has('create')"],
    // One action at a time, and only its own button says so -- not every button on the screen.
    ['SecurityManager', "pressed('add')"],
    ['MediaLibrary', 'uploading'],
    ['MediaLibrary', 'deleting'],
    ['PasskeySignIn', 'busy'],
    // Publish or Update, and not the autosave: that is shown by the save state beside it.
    ['Editor', 'publishing'],
    ['PageEditor', 'publishing'],
    // The file field that was pressed, not the other two beside it.
    ['SiteBrandFields', "pressed(kind, 'upload')"],
    ['UpdateManager', 'checking'],
    ['PostSettingsDrawer', 'suggesting'],
    ['ExcerptSuggestion', 'asking'],
  ];
  for (const [component, flag] of controls) {
    const source = read(`src/components/admin/${component}.tsx`);
    assert.ok(source.includes(`aria-busy={${flag}}`), `${component} has no control reporting ${flag}`);
  }
  // The seven save buttons are one component, and its spinner comes from the same aria-busy.
  for (const component of ['SettingsForm', 'ProfileForm', 'MaintenanceForm', 'NavigationManager', 'SlidesManager', 'PluginManager', 'MediaLibrary']) {
    assert.match(read(`src/components/admin/${component}.tsx`), /<SaveButton[\s\S]{0,400}?state=\{saveButtonState\(/, `${component} has a save button that does not carry its state`);
  }
  assert.match(read('src/components/admin/SaveButton.tsx'), /aria-busy=\{state === 'saving'\}/);
  // A save button's words are on the button, not in a status line beside it.
  assert.doesNotMatch(read('src/components/admin/SettingsForm.tsx'), /copy\.settings\.saving/);
  const swapped: ReadonlyArray<readonly [string, RegExp]> = [
    ['MediaLibrary', /\{deleting \? copy\.media\.deleting : copy\.media\.delete\}/],
    ['UpdateManager', /\{busy \? copy\.updates\.checking : copy\.updates\.checkAgain\}/],
    ['UpdateManager', /\{installing \? copy\.updates\.verifying/],
    ['PostSettingsDrawer', /\{suggesting \? copy\.drawer\.suggestingCategories/],
    ['ExcerptSuggestion', /\{asking \? copy\.drawer\.suggestingExcerpt/],
  ];
  for (const [component, label] of swapped) {
    assert.doesNotMatch(read(`src/components/admin/${component}.tsx`), label, `${component} swaps its label while it works`);
  }
});

test('a save button keeps one width and says Saved without greying out', () => {
  assert.equal(declaration(ruleBody(CSS, '.admin-save-button'), 'display'), 'inline-grid');
  assert.equal(declaration(ruleBody(CSS, '.admin-save-button__label'), 'grid-area'), '1 / 1');
  assert.equal(declaration(ruleBody(CSS, '.admin-save-button[data-state="saved"]:disabled'), 'opacity'), '1');
});

test('a pressed control spins long enough to be seen', () => {
  // A quick save answered in twenty milliseconds and its spinner lasted one frame. atLeast
  // holds every one of these for MIN_BUSY_MS, so a press is always seen to have been taken.
  for (const component of [
    'SettingsForm', 'ProfileForm', 'ThemeForm', 'PluginManager', 'CategoryManager', 'NavigationManager', 'RedirectManager',
    'SecurityManager', 'MediaLibrary', 'SiteBrandFields', 'UpdateManager', 'PostSettingsDrawer', 'ExcerptSuggestion', 'Editor', 'PageEditor',
  ]) {
    assert.match(read(`src/components/admin/${component}.tsx`), /\batLeast\(/, `${component} lets its spinner flash`);
  }
});

test('a row that is working dims rather than spinning inside its menu', () => {
  // A spinner inside a menu item is noise in a 10rem box, and the menu closes as you
  // click it -- so the card or row the action belongs to carries the state instead.
  assert.match(CSS, /\.admin-story-row\[aria-busy="true"\] \{[^}]*opacity: 0\.6/);
  const list = read('src/lib/admin-story-list.ts');
  assert.match(list, /card\?\.setAttribute\('aria-busy', 'true'\)/);
  assert.match(list, /card\?\.removeAttribute\('aria-busy'\)/);
});

test('the shell has no top bar on a desktop and no search anywhere', () => {
  const shell = read('src/components/admin/AdminShell.astro');
  assert.doesNotMatch(shell, /admin-topbar__search/, 'the search field is still in the shell');
  assert.doesNotMatch(shell, /postSearchState/, 'the shell still computes a search state');
  assert.doesNotMatch(read('src/lib/admin.ts'), /postSearchState/, 'the helper outlived its only caller');
  // The bar is the phone's: hidden from 64rem up, where the page head is the masthead.
  assert.match(CSS, /@media \(min-width: 64rem\) \{[\s\S]*?\.admin-topbar \{ display: none; \}/);
});

test('the sidebar sits on the page and marks the active link with a bar, not a fill', () => {
  const wide = /@media \(min-width: 64rem\) \{\s*\.admin-sidebar \{([^}]*)\}/.exec(CSS)?.[1] ?? '';
  assert.doesNotMatch(wide, /background/, 'the sidebar still paints its own column');
  assert.doesNotMatch(wide, /border-right/, 'the sidebar still draws a column edge');
  const active = ruleBody(CSS, '.admin-sidebar nav a[aria-current=\'page\']::before,\n.admin-mobile-nav nav a[aria-current=\'page\']::before');
  assert.equal(declaration(active, 'width'), '2px');
  assert.equal(declaration(active, 'background'), 'var(--color-accent)');
  assert.doesNotMatch(CSS, /\.admin-sidebar nav a\[aria-current='page'\][^:{]*\{[^}]*background: var\(--color-paper/, 'the active link still fills');
});

test('an eyebrow is one rule, shared by the nav groups and the page heads', () => {
  const eyebrow = ruleBody(CSS, '.admin-eyebrow,\n.admin-nav-group');
  assert.equal(declaration(eyebrow, 'text-transform'), 'uppercase');
  assert.equal(declaration(eyebrow, 'letter-spacing'), '0.12em');
  assert.equal(declaration(eyebrow, 'font-size'), '0.6875rem');
  assert.equal(declaration(eyebrow, 'color'), 'var(--color-muted)');
});

test('the site line is a line under the logo, not a pill', () => {
  const site = ruleBody(CSS, '.admin-shell-site');
  assert.equal(declaration(site, 'background'), undefined);
  assert.equal(declaration(site, 'border-radius'), undefined);
  assert.match(declaration(site, 'border-block-end') ?? '', /var\(--color-rule\)$/);
});

test('every page head carries an eyebrow, and the title is the display face at 700', () => {
  const heads = [
    'src/pages/admin/index.astro', 'src/pages/admin/pages/index.astro', 'src/pages/admin/categories.astro',
    'src/pages/admin/redirects.astro', 'src/pages/admin/stats.astro', 'src/pages/admin/profile.astro',
    'src/pages/admin/security.astro', 'src/pages/admin/settings.astro', 'src/pages/admin/system.astro',
    'src/pages/admin/plugins.astro', 'src/pages/admin/themes/index.astro', 'src/components/admin/MediaLibrary.tsx',
    'src/components/admin/NavigationManager.tsx', 'src/components/admin/MaintenanceForm.tsx', 'src/components/admin/SlidesManager.tsx',
  ];
  for (const head of heads) {
    assert.match(read(head), /admin-page__head[\s\S]{0,120}?class(?:Name)?="admin-eyebrow"/, `${head} has no eyebrow`);
  }
  const title = ruleBody(CSS, '.admin-page__head h1');
  // 700, not 600: Google Sans Thai ships one bold weight and font-synthesis is off, so a 600
  // Thai title would fall back to the body face without a word of warning.
  assert.equal(declaration(title, 'font-weight'), '700');
  assert.equal(declaration(title, 'font-family'), 'var(--font-display)');
});

test('the list screens filter from the tab row', () => {
  for (const page of ['src/pages/admin/index.astro', 'src/pages/admin/pages/index.astro']) {
    const source = read(page);
    assert.match(source, /class="admin-list-bar"/, `${page} has no list bar`);
    assert.doesNotMatch(source, /name="q"/, `${page} still has a title search`);
    assert.doesNotMatch(source, /copy\.filters\.apply/, `${page} still has Apply filters`);
  }
  // .admin-control (later in the file, equal specificity) would box the select again, so the
  // filter's rule has to outrank it.
  const select = ruleBody(CSS, '.admin-list-filter .admin-list-filter__select');
  assert.equal(declaration(select, 'border-radius'), '0');
  assert.equal(declaration(select, 'background-color'), 'transparent');
  assert.equal(declaration(ruleBody(CSS, '.admin-list-bar'), 'margin-block-end'), 'var(--space-lg)');
});

test('a form is a stack of sheets: no box, a rule between, two columns when the stack is wide', () => {
  const card = ruleBody(CSS, '.admin-card');
  assert.equal(declaration(card, 'border'), undefined, 'a sheet has no frame');
  assert.equal(declaration(card, 'background'), undefined, 'a sheet has no fill');
  assert.equal(declaration(card, 'border-radius'), undefined);
  assert.match(CSS, /\.admin-card \+ \.admin-card \{ border-block-start: var\(--rule-hair\) solid var\(--color-rule\); \}/);
  assert.equal(declaration(ruleBody(CSS, '.admin-card-stack'), 'container-type'), 'inline-size');
  // 53rem: a 16rem head column, 2rem between, a 34rem field column. Under it one column, so
  // a 768px tablet (a 640px main column) stacks and a 1024px one does not.
  assert.match(CSS, /@container \(min-width: 53rem\) \{\s*\.admin-card \{ grid-template-columns: 16rem minmax\(0, 34rem\); column-gap: var\(--space-xl\);/);
});

test('the save bar is a row on the page edge, with its state beside the button', () => {
  const bar = ruleBody(CSS, '.admin-save-bar');
  assert.equal(declaration(bar, 'border-radius'), undefined);
  assert.equal(declaration(bar, 'inset-block-end'), '0');
  assert.match(declaration(bar, 'border-block-start') ?? '', /var\(--color-rule\)$/);
  // row-reverse: flex-start is the right edge, where the button goes.
  assert.equal(declaration(bar, 'justify-content'), 'flex-start');
  assert.equal(declaration(bar, 'flex-direction'), 'row-reverse');
});

test('Settings and Maintenance are two tabs of one section', () => {
  assert.match(read('src/pages/admin/settings.astro'), /admin-page__head admin-page__head--tabs[\s\S]*?admin-post-tabs admin-subtabs[\s\S]*?aria-current="page"[^>]*>\{copy\.nav\.general\}/);
  assert.match(read('src/components/admin/MaintenanceForm.tsx'), /admin-post-tabs admin-subtabs[\s\S]*?aria-current="page"[^>]*>\{[\w.]*maintenance\}/);
});

test('a stack nested in a stack keeps the rule and the air above its first sheet', () => {
  assert.match(CSS, /\.admin-card-stack \.admin-card-stack > \.admin-card:first-child \{ padding-block-start: var\(--space-xl\); border-block-start: var\(--rule-hair\) solid var\(--color-rule\); \}/);
});

test('the stats screen leads with figures, and boxes nothing', () => {
  const stats = read('src/styles/stats.css');
  const rule = (selector: string) => ruleBody(stats, selector);
  const value = rule('.stats-summary__value');
  assert.equal(declaration(value, 'font-family'), 'var(--font-display)');
  assert.equal(declaration(value, 'font-size'), 'var(--text-3xl)');
  assert.equal(declaration(value, 'font-variant-numeric'), 'tabular-nums');
  // A five-digit total must wrap, not overflow a narrow column.
  assert.equal(declaration(value, 'overflow-wrap'), 'anywhere');
  const figure = rule('.stats-summary > div');
  assert.equal(declaration(figure, 'border'), undefined);
  assert.equal(declaration(figure, 'background'), undefined);
  assert.equal(declaration(rule('.stats-panel'), 'border'), undefined);
  assert.equal(declaration(rule('.stats-panel'), 'background'), undefined);
  assert.equal(declaration(rule('.stats-panel h2'), 'font-family'), 'var(--font-display)');
  assert.equal(declaration(rule('.stats-table th'), 'text-transform'), 'uppercase');
  assert.match(read('src/components/admin/stats/StatsReport.astro'), /<dt class="admin-eyebrow">\{copy\.stats\.views\}<\/dt>/);
});

test('a status is a dot and a word, with no pill behind it', () => {
  const status = ruleBody(CSS, '.admin-status');
  assert.equal(declaration(status, 'background'), undefined);
  assert.equal(declaration(status, 'border-radius'), undefined);
  assert.equal(declaration(status, 'color'), 'var(--color-ink-2)');
  assert.doesNotMatch(CSS, /\.admin-status\[data-status="published"\] \{[^}]*background/);
});

test('a card title is the display face, and the timezone is said once per list', () => {
  assert.equal(declaration(ruleBody(CSS, '.admin-story-content h2'), 'font-family'), 'var(--font-display)');
  for (const page of ['src/pages/admin/index.astro', 'src/pages/admin/pages/index.astro']) {
    const source = read(page);
    assert.match(source, /copy\.row\.timezoneNote/, `${page} does not say the timezone once`);
    assert.doesNotMatch(source, /\(\{settings\?\.timezone \?\? 'UTC'\}\)/, `${page} still says it on every card`);
  }
});

test('a table head is an eyebrow on a rule', () => {
  const wide = /@media \(min-width: 48rem\) \{\s*\.admin-page-list[\s\S]*?\n\}/.exec(CSS)?.[0] ?? '';
  assert.match(wide, /\.admin-page-head \{[^}]*text-transform: uppercase/);
  assert.match(wide, /\.admin-page-head \{[^}]*letter-spacing: 0\.12em/);
  assert.equal(declaration(ruleBody(CSS, '.admin-story-panel'), 'border'), undefined, 'the page list is still boxed');
});

test('a filename is a title, and a one-sentence empty state has no heading', () => {
  const name = ruleBody(CSS, '.media-card strong');
  assert.equal(declaration(name, 'font-family'), 'var(--font-display)');
  assert.equal(declaration(name, 'font-size'), 'var(--text-base)');
  assert.equal(declaration(name, 'font-weight'), '700');
  for (const file of ['src/components/admin/NavigationManager.tsx', 'src/components/admin/SlidesManager.tsx']) {
    assert.doesNotMatch(read(file), /<div className="admin-empty">\s*<p className="admin-eyebrow">[^\n]*\n\s*<h2>/, `${file} sets its sentence as a heading`);
  }
});

test('"Show all" from an empty tab links to status=all', () => {
  assert.match(read('src/pages/admin/index.astro'), /admin-empty--filtered[\s\S]{0,200}?status[^<]*all/);
  assert.match(read('src/pages/admin/pages/index.astro'), /admin-empty--filtered[\s\S]{0,200}?status[^<]*all/);
});

test('the list filters choose a language through the admin select, which submits on a choice', () => {
  for (const file of ['src/pages/admin/index.astro', 'src/pages/admin/pages/index.astro']) {
    const source = read(file);
    assert.match(source, /<UiSelect[\s\S]{0,400}?name="locale"[\s\S]{0,300}?submitOnChange/, file);
    assert.doesNotMatch(source, /admin-list-filter__submit|<select/, file);
  }
  const select = read('src/components/admin/UiSelect.tsx');
  assert.match(select, /closest\('form'\)\?\.requestSubmit\(\)/);
  assert.match(select, /placePopover\(/);
});

test('a field turns red only when the admin says so', () => {
  // :user-invalid reds a required field again after a save resets it to '', with no message to explain it.
  const root = new URL('../../', import.meta.url);
  for (const dir of ['src/styles', 'src/themes']) {
    for (const file of readdirSync(new URL(dir, root), { recursive: true, encoding: 'utf8' })) {
      if (!file.endsWith('.css')) continue;
      assert.doesNotMatch(read(`${dir}/${file}`), /:user-invalid|:invalid\b/, `${dir}/${file}`);
    }
  }
  assert.match(CSS, /\.admin-control\[aria-invalid="true"\] \{ border-color: var\(--color-error\)/);
});

test('no control opens a picker drawn by the operating system', () => {
  // The file chooser is the one exception the web imposes, and `type="file"` is not in this list.
  const root = new URL('../../', import.meta.url).pathname;
  for (const file of execSync('git ls-files src/components src/pages', { cwd: root, encoding: 'utf8' }).trim().split('\n')) {
    if (!/\.(astro|tsx)$/.test(file)) continue;
    assert.doesNotMatch(read(file), /<select\b|type=["'](?:date|datetime-local|time|month|week|color)["']/, file);
  }
});

/** Every `<form ...>` opening tag in a source, read to its closing `>` past any `{...}` attribute value. */
function formTags(source: string): string[] {
  const tags: string[] = [];
  for (const match of source.matchAll(/<form\b/g)) {
    let depth = 0;
    let end = match.index;
    for (; end < source.length; end += 1) {
      const char = source[end];
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      else if (char === '>' && depth === 0) break;
    }
    tags.push(source.slice(match.index, end + 1));
  }
  return tags;
}

test('no admin form lets the browser draw its own validation bubble', () => {
  // The bubble is drawn by the operating system, so every admin form checks in the admin's own words.
  // No exceptions: a form that submits nothing natively still takes the attribute.
  const root = new URL('../../', import.meta.url).pathname;
  let seen = 0;
  for (const file of execSync('git ls-files src/components/admin src/pages/admin', { cwd: root, encoding: 'utf8' }).trim().split('\n')) {
    const isTsx = /^src\/components\/admin\/[^/]+\.tsx$/.test(file);
    if (!isTsx && !/\.astro$/.test(file)) continue;
    const pattern = isTsx ? /\snoValidate\b/ : /\snovalidate\b/;
    for (const tag of formTags(read(file))) {
      seen += 1;
      assert.match(tag, pattern, `${file}: ${tag.slice(0, 60)}`);
    }
  }
  assert.ok(seen >= 19, `expected to find the admin's forms, found ${seen}`);
});

test('the menu screen leaves the words of saving to the Save button', () => {
  // A status line set before the request stays on screen after it lands and says the wrong thing.
  const navigation = read('src/components/admin/NavigationManager.tsx');
  assert.doesNotMatch(navigation, /setStatus\(copy\.navigation\.saving/);
});

test('the date-time field clears to nothing and closes like a menu', () => {
  const field = read('src/components/admin/UiDateTime.tsx');
  assert.match(field, /onClick=\{\(\) => \{ if \(value\) onChange\(''\); close\(\); \}\}/, 'Clear hands the caller an empty value, and an empty field nothing');
  assert.match(field, /event\.key === 'Escape'/);
  assert.match(field, /placePopover\(/);
  assert.match(field, /role="grid"/);
  assert.match(read('src/styles/global.css'), /@media \(pointer: coarse\) \{[^}]*\}[^}]*\.ui-datetime__day \{ min-height: 44px; \}/, 'a day is 44px under a coarse pointer');
  for (const file of ['PostSettingsDrawer', 'PageSettingsDrawer', 'MaintenanceForm', 'SlidesManager']) {
    assert.match(read(`src/components/admin/${file}.tsx`), /<UiDateTime\b/, file);
  }
});

test('the skeletons keep the tab row, the eyebrow and the note their pages draw', () => {
  const skeleton = read('src/components/admin/AdminSkeleton.astro');
  assert.match(skeleton, /kind === 'settings'[\s\S]*?admin-post-tabs admin-subtabs/);
  assert.match(skeleton, /<div class="admin-page__head">\s*<div>\s*<span class="skeleton-line" style="--skeleton-width: 4rem">/);
  assert.match(skeleton, /admin-page__note/);
  assert.match(read('src/components/PageTransitionSkeleton.astro'), /'settings'/);
  assert.match(read('src/pages/admin/maintenance.astro'), /<AdminSkeleton kind="settings"/);
});

test('a Stats change is set in the link colour, a note is not', () => {
  const stats = read('src/styles/stats.css');
  assert.equal(declaration(ruleBody(stats, '.stats-summary__change--delta'), 'color'), 'var(--color-link)');
  assert.equal(declaration(ruleBody(stats, '.stats-summary__change--delta'), 'font-weight'), '600');
  assert.match(read('src/components/admin/stats/StatsReport.astro'), /stats-summary__change--delta/);
});

test('the Stats tabs stand on one full-width rule, and the figures draw no second one', () => {
  const stats = read('src/styles/stats.css');
  // On the filters block, as every other tab row in the admin: on the two groups it broke into
  // two stubs with a gap between them on a desktop.
  assert.equal(declaration(ruleBody(stats, '.stats-filters'), 'border-block-end'), 'var(--rule-hair) solid var(--color-rule)');
  assert.equal(declaration(ruleBody(stats, '.stats-segments'), 'border-block-end'), undefined);
  assert.equal(declaration(ruleBody(stats, '.stats-filters + .stats-summary'), 'border-block-start'), '0');
  assert.match(stats, /\.stats-share li::before \{[^}]*opacity: 0\.5/);
  assert.doesNotMatch(CSS, /\.admin-empty--inline a, \.admin-empty--inline button/);
});

test('the work sits on the lightest surface, the sidebar on the page behind it', () => {
  // --color-paper is the raised surface in both themes (white in light, the lighter night in dark);
  // the sidebar is left on .admin-shell's --color-paper-2.
  assert.equal(declaration(ruleBody(CSS, '.admin-shell-main'), 'background'), 'var(--color-paper)');
  assert.equal(declaration(ruleBody(CSS, '.admin-shell'), 'background'), 'var(--color-paper-2)');
  // What sits on or floats over the main column mixes its surface, not the sidebar's.
  assert.equal(declaration(ruleBody(CSS, '.admin-topbar'), 'background'), 'var(--color-paper)');
  assert.match(declaration(ruleBody(CSS, '.admin-save-bar'), 'background') ?? '', /color-mix\(in oklch, var\(--color-paper\) 94%/);
});

test('a row menu floats, is quiet at rest, and closes like a menu', () => {
  const panel = ruleBody(CSS, '.admin-story-menu > div');
  assert.equal(declaration(panel, 'box-shadow'), 'var(--shadow-float)');
  assert.match(declaration(panel, 'border') ?? '', /var\(--color-rule\)$/);
  assert.match(CSS, /\.admin-story-menu summary:focus-visible \{ outline: 2px solid var\(--color-focus\); outline-offset: -2px; \}/);
  for (const page of ['src/pages/admin/index.astro', 'src/pages/admin/pages/index.astro']) {
    assert.match(read(page), /wireDetailsMenus\('details\.admin-story-menu'\)/, page);
  }
  assert.match(read('src/components/admin/MediaLibrary.tsx'), /wireDetailsMenus\('details\.media-category-menu'\)/);
});

test('a note is a paragraph with a 2px bar and a 16px heading, and it sits under the grid, not in it', () => {
  assert.doesNotMatch(read('src/components/admin/PluginManager.tsx'), /plugin-card--source/);
  const note = ruleBody(CSS, '.admin-notes');
  assert.equal(declaration(note, 'margin-block-start'), 'var(--space-xl)');
  assert.equal(declaration(ruleBody(CSS, '.admin-card.admin-card--note h2'), 'font-size'), 'var(--text-base)');
  assert.doesNotMatch(CSS, /border-inline-start: 3px solid/, 'a bar is 2px');
});

test('every radio and checkbox in the admin shell takes the accent colour from one rule', () => {
  const rule = /(?:^|\n)([^{}\n]*\.admin-body[^{}]*)\{([^}]*accent-color:\s*var\(--color-accent\)[^}]*)\}/.exec(CSS);
  assert.ok(rule, 'no admin-wide accent-color rule');
  assert.match(rule[1], /\.admin-body input\[type="radio"\]/);
  assert.match(rule[1], /\.admin-body input\[type="checkbox"\]/);
  // The per-surface copies inside global.css are gone; the rule above is the only one there.
  assert.equal(CSS.match(/accent-color/g)?.length, 1);
});

test('the library takes several files into a chosen folder, and its button rings only for the keyboard', () => {
  const library = read('src/components/admin/MediaLibrary.tsx');
  assert.match(library, /multiple=\{props\.mode === 'manage'\}/);
  assert.match(library, /<MediaUploadDialog\b/);
  assert.doesNotMatch(CSS, /\.media-upload:focus-within/);
  assert.match(CSS, /\.media-upload:has\(input:focus-visible\)/);
  const dialog = read('src/components/admin/MediaUploadDialog.tsx');
  assert.match(dialog, /runQueue\(/);
  // A row shows its type and size the way the library does, not raw kilobytes.
  assert.match(dialog, /formatLabel\(declaredMediaType\(file\)\)/);
  assert.match(dialog, /formatBytes\(file\.size\)/);
  assert.doesNotMatch(dialog, /1024\)\} KB/);
});
