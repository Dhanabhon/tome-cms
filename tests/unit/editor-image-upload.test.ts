import assert from 'node:assert/strict';
import test from 'node:test';

import { getSchema } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import { type EditorView } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';

import { createImageUpload, imageUploadKey, imageUploadPlugin } from '../../src/components/admin/editor/editor-image-upload';

const stateWithPlugin = () => EditorState.create({
  plugins: [imageUploadPlugin()],
  schema: getSchema([StarterKit.configure({ link: false, underline: false })]),
});

test('the picture waits where it will land, and leaves when the upload answers', () => {
  const id = {};
  const empty = stateWithPlugin();
  const waiting = empty.apply(empty.tr.setMeta(imageUploadKey, { add: { id, pos: 0, src: 'data:image/png;base64,' } }));
  assert.equal(imageUploadKey.getState(waiting)?.find().length, 1, 'one placeholder while it uploads');

  const answered = waiting.apply(waiting.tr.setMeta(imageUploadKey, { remove: { id } }));
  assert.equal(imageUploadKey.getState(answered)?.find().length, 0, 'and none once it has an answer');
});

test('the picture keeps its place as words are written before it', () => {
  const id = {};
  const empty = stateWithPlugin();
  const waiting = empty.apply(empty.tr.setMeta(imageUploadKey, { add: { id, pos: 1, src: 'data:image/png;base64,' } }));
  const before = imageUploadKey.getState(waiting)?.find()[0]?.from ?? -1;

  const typed = waiting.apply(waiting.tr.insertText('four words before it', 1));
  const after = imageUploadKey.getState(typed)?.find()[0]?.from ?? -1;
  assert.equal(after, before + 'four words before it'.length, 'the placeholder moved with the words');
});

test('a file the uploader refuses never touches the document', () => {
  let dispatched = 0;
  const view = { dispatch: () => { dispatched += 1; }, isDestroyed: false, state: stateWithPlugin() } as unknown as EditorView;
  const upload = createImageUpload({ onUpload: async () => 'never asked for', validate: () => false });

  upload(new File(['not a picture'], 'guide.pdf', { type: 'application/pdf' }), view, 0);
  assert.equal(dispatched, 0, 'nothing was dispatched for a file that was refused');
});
