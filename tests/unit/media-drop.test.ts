import assert from 'node:assert/strict';
import { test } from 'node:test';

import { carriesFiles, dropFolderName, splitDrop } from '../../src/lib/media-drop';

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
