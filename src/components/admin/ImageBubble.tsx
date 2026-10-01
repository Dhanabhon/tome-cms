import { isNodeSelection } from '@tiptap/core';
import { useCurrentEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { useEffect, useRef, useState } from 'react';

import type { AdminCopy } from '../../lib/admin-i18n';
import type { MediaAsset, PostLocale } from '../../types/cms';
import Icon from '../Icon';
import MediaPicker from './MediaPicker';

/**
 * A chosen picture's own bar, over its top left corner as the table's is. Replace picture swaps
 * the file, and its name with it, and keeps the rest of the picture: where it is, and its alt text
 * unless it had none.
 */
export default function ImageBubble({ copy, ownerLocale }: { copy: AdminCopy; ownerLocale?: PostLocale | null }) {
  const { editor } = useCurrentEditor();
  // Where the picture is, kept while the File Manager is open: the selection may not survive it.
  const [replacing, setReplacing] = useState<number | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  // Tiptap makes the bar's own box a tab stop, with no name and nothing to press: Tab from the
  // picture landed there, and only a second Tab reached Replace picture. This runs after the
  // bar's plugin is set up, which is what sets it.
  useEffect(() => {
    if (bar.current) bar.current.tabIndex = -1;
  }, [editor]);
  if (!editor) return null;

  const replace = (asset: MediaAsset) => {
    const at = replacing;
    setReplacing(null);
    const picture = at === null ? null : editor.state.doc.nodeAt(at);
    if (at === null || picture?.type.name !== 'image') return;
    // One step, so one undo puts the old picture back.
    editor.chain().focus().setNodeSelection(at).updateAttributes('image', {
      alt: picture.attrs.alt || asset.alt_text || '',
      mediaId: asset.id,
      src: asset.publicUrl,
      // As an insert names it: the old file's name would be left on the new picture.
      title: asset.original_name,
    }).run();
  };

  return (
    <>
      <BubbleMenu
        className="editor-menu rounded-md border border-line bg-surface p-1 font-sans"
        editor={editor}
        options={{ placement: 'top-start' }}
        pluginKey="imageBubble"
        ref={bar}
        shouldShow={({ editor: instance, state: { selection } }) => instance.isEditable
          && isNodeSelection(selection) && selection.node.type.name === 'image'}
      >
        <div aria-label={copy.blocks.image} className="flex" role="group">
          <button
            className="flex h-8 items-center gap-1.5 rounded px-2 text-sm font-semibold text-ink hover:bg-soft [&_.icon]:h-4 [&_.icon]:w-4"
            onClick={() => setReplacing(editor.state.selection.from)}
            type="button"
          >
            <Icon name="media" />
            {copy.editor.replacePicture}
          </button>
        </div>
      </BubbleMenu>
      {replacing !== null && (
        <MediaPicker
          kind="image"
          onCancel={() => {
            setReplacing(null);
            editor.commands.focus();
          }}
          onSelect={replace}
          ownerLocale={ownerLocale}
          returnFocus={editor.view.dom}
        />
      )}
    </>
  );
}
