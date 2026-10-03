import assert from 'node:assert/strict';
import { test } from 'node:test';

import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import SaveButton from '../../src/components/admin/SaveButton.tsx';
import UpdateManager from '../../src/components/admin/UpdateManager.tsx';
import { adminCopy } from '../../src/lib/admin-i18n.ts';
import { adminButtonClass } from '../../src/lib/ui-dialog.ts';
import type { SaveState } from '../../src/lib/save-state.ts';

// tsx compiles the components' JSX to React.createElement, the classic runtime; Astro's build uses the automatic one.
Object.assign(globalThis, { React });

const save = (state: SaveState) => renderToStaticMarkup(createElement(SaveButton, { label: 'Save', savedLabel: 'Saved', savingLabel: 'Saving', state }));

test('an unchanged Save is a secondary button; a change makes it the primary', () => {
  for (const state of ['idle', 'saved'] as const) {
    assert.doesNotMatch(save(state), /admin-button--primary/, state);
    assert.match(save(state), /admin-button--secondary/, state);
    assert.match(save(state), /disabled=""/, state);
  }
  for (const state of ['dirty', 'saving'] as const) {
    assert.match(save(state), /admin-button--primary/, state);
    assert.doesNotMatch(save(state), /admin-button--secondary/, state);
  }
});

test("a dialog's confirm is its one filled button, in the danger fill when it deletes", () => {
  assert.equal(adminButtonClass('confirm', 'default'), 'admin-button admin-button--primary');
  assert.equal(adminButtonClass('confirm', 'danger'), 'admin-button admin-button--primary admin-button--danger');
  for (const kind of ['cancel', 'secondary'] as const) {
    assert.doesNotMatch(adminButtonClass(kind, 'danger'), /admin-button--primary/, kind);
  }
});

test('System shows the installed version before the check returns, and says it is checking once', () => {
  const html = renderToStaticMarkup(createElement(UpdateManager, { installedVersion: '1.14.0', ownerLocale: 'en' }));
  assert.match(html, /<dt>Installed version:<\/dt><dd>1\.14\.0<\/dd>/);
  assert.equal(html.split(adminCopy('en').updates.checkingForUpdates).length - 1, 1, html);
});
