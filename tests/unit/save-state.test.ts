import assert from 'node:assert/strict';
import test from 'node:test';

import { saveButtonState } from '../../src/lib/save-state';

test('a save button says what the form is waiting for', () => {
  assert.equal(saveButtonState({ saving: false, dirty: false, savedOnce: false }), 'idle');
  assert.equal(saveButtonState({ saving: false, dirty: true, savedOnce: false }), 'dirty');
  assert.equal(saveButtonState({ saving: true, dirty: true, savedOnce: false }), 'saving');
  assert.equal(saveButtonState({ saving: false, dirty: false, savedOnce: true }), 'saved');
});

test('an edit after a save asks to be saved again, and spinning wins over everything', () => {
  assert.equal(saveButtonState({ saving: false, dirty: true, savedOnce: true }), 'dirty');
  assert.equal(saveButtonState({ saving: true, dirty: false, savedOnce: true }), 'saving');
});

test('a failed save leaves the button asking to save, not claiming it saved', () => {
  // A failure clears saving and never sets savedOnce; the draft is still dirty.
  assert.equal(saveButtonState({ saving: false, dirty: true, savedOnce: false }), 'dirty');
});
