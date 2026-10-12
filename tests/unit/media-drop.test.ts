import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MediaFileError } from '../../src/lib/media';
import { carriesFiles, dropBlocked, dropFolderName, pickerDrop, splitDrop } from '../../src/lib/media-drop';

const png = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });
const fileItem = (file: File, isDirectory = false) => ({ kind: 'file', getAsFile: () => file, webkitGetAsEntry: () => ({ isDirectory }) });

test('only a drag that carries files from the computer counts', () => {
  assert.equal(carriesFiles(['Files']), true);
  assert.equal(carriesFiles(['application/x-moz-file', 'Files']), true);
  assert.equal(carriesFiles(['text/plain']), false);
  assert.equal(carriesFiles(['text/uri-list', 'text/html']), false);
  assert.equal(carriesFiles([]), false);
  assert.equal(carriesFiles(undefined), false);
});

test('files are kept and folders are counted as skipped', () => {
  const a = png('a.png');
  const b = png('b.png');
  const folder = new File([], 'Holiday');
  const { files, skipped } = splitDrop({ items: [fileItem(a), fileItem(folder, true), fileItem(b)] });
  assert.deepEqual(files, [a, b]);
  assert.equal(skipped, 1);
});

test('a string item is not a file and is not counted', () => {
  const a = png('a.png');
  const { files, skipped } = splitDrop({ items: [{ kind: 'string', getAsFile: () => null }, fileItem(a)] });
  assert.deepEqual(files, [a]);
  assert.equal(skipped, 0);
});

test('without the entry API an empty file with no type is taken for a folder', () => {
  const a = png('a.png');
  const folder = new File([], 'Holiday');
  const { files, skipped } = splitDrop({ items: [{ kind: 'file', getAsFile: () => a }, { kind: 'file', getAsFile: () => folder }] });
  assert.deepEqual(files, [a]);
  assert.equal(skipped, 1);
});

test('an empty file the entry API says is a file is still a file', () => {
  const empty = new File([], 'empty.txt');
  assert.deepEqual(splitDrop({ items: [fileItem(empty)] }), { files: [empty], skipped: 0 });
});

test('a drop with no items falls back to its files', () => {
  const a = png('a.png');
  const folder = new File([], 'Holiday');
  assert.deepEqual(splitDrop({ files: [a, folder] }), { files: [a], skipped: 1 });
  assert.deepEqual(splitDrop({}), { files: [], skipped: 0 });
});

test('the overlay names the open folder, or Unsorted', () => {
  const folders = [{ id: 'f1', name: 'Holiday' }];
  assert.equal(dropFolderName('f1', folders, 'Unsorted'), 'Holiday');
  assert.equal(dropFolderName(null, folders, 'Unsorted'), 'Unsorted');
  assert.equal(dropFolderName(undefined, folders, 'Unsorted'), 'Unsorted');
  assert.equal(dropFolderName('gone', folders, 'Unsorted'), 'Unsorted');
});

test('a picker takes one file of its kind, and says why it takes anything else', () => {
  const a = png('a.png');
  const pdf = new File([new Uint8Array([37, 80, 68, 70])], 'notes.pdf', { type: 'application/pdf' });
  assert.deepEqual(pickerDrop({ files: [a], skipped: 0 }, 'image'), { file: a });
  assert.deepEqual(pickerDrop({ files: [pdf], skipped: 0 }, 'any'), { file: pdf });
  assert.deepEqual(pickerDrop({ files: [a, png('b.png')], skipped: 0 }, 'image'), { refused: 'several' });
  assert.deepEqual(pickerDrop({ files: [a], skipped: 1 }, 'image'), { refused: 'several' }, 'a file and a folder are two things');
  assert.deepEqual(pickerDrop({ files: [], skipped: 1 }, 'image'), { refused: 'folder' });
  assert.equal(pickerDrop({ files: [], skipped: 0 }, 'image'), null, 'nothing dropped, nothing said');
  const wrong = pickerDrop({ files: [pdf], skipped: 0 }, 'image');
  assert.ok(wrong && 'error' in wrong && wrong.refused === 'file');
  assert.ok(wrong.error instanceof MediaFileError && wrong.error.refusal === 'unsupportedImage', 'the same refusal as the upload button');
  const picture = pickerDrop({ files: [a], skipped: 0 }, 'document');
  assert.ok(picture && 'error' in picture && picture.error instanceof MediaFileError && picture.error.refusal === 'unsupportedDocument');
});

/** An element as far as the drop rule reads it: the open dialog it is in, and whether that one is leaving. */
const dialog = (closing = false) => {
  const element = { closest: () => element, hasAttribute: (name: string) => closing && name === 'data-closing' } as unknown as Element;
  return element;
};
const inside = (home: Element | null) => ({ closest: () => home });

test('a drop is taken only where no other dialog is on top', () => {
  const picker = dialog();
  const confirm = dialog();
  // The library page: nothing open takes it, any dialog over it does not.
  assert.equal(dropBlocked(inside(null), null), false);
  assert.equal(dropBlocked(inside(confirm), null), true);
  assert.equal(dropBlocked(null, null), false);
  // A picker: its own dialog takes it, one on top of it does not, and so does the page behind.
  assert.equal(dropBlocked(inside(picker), picker), false);
  assert.equal(dropBlocked(picker, picker), false, 'its backdrop is the dialog');
  assert.equal(dropBlocked(inside(confirm), picker), true);
  assert.equal(dropBlocked(inside(null), picker), true);
  assert.equal(dropBlocked(null, picker), true);
  // A picker on its way out takes nothing more.
  const leaving = dialog(true);
  assert.equal(dropBlocked(inside(leaving), leaving), true);
});
