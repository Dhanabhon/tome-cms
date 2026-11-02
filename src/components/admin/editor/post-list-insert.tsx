import type { Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { createRoot } from 'react-dom/client';

import type { AdminCopy } from '../../../lib/admin-i18n';
import type { PostListAttrs } from '../../../lib/editor-post-list';
import type { PostLocale } from '../../../types/cms';
import PostListDialog from './PostListDialog';

/** Opens the settings window, outside the editor's own DOM, and answers with what it was saved as. */
export function askForPostList(copy: AdminCopy, locale: PostLocale, current?: PostListAttrs): Promise<PostListAttrs | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    root.render(
      <PostListDialog
        copy={copy}
        current={current}
        locale={locale}
        onDone={(attrs) => {
          root.unmount();
          host.remove();
          resolve(attrs);
        }}
      />,
    );
  });
}

/**
 * A block lives at the top of the document, so a caret inside a quote or a list puts it after that
 * block. An empty line is replaced: nobody means to keep it. A selected block has a position of its
 * own and no line to be in, so the new one goes after it.
 */
export function insertPostList(editor: Editor, attrs: PostListAttrs): void {
  const { $from, to } = editor.state.selection;
  const emptyLine = $from.depth === 1 && $from.parent.type.name === 'paragraph' && $from.parent.content.size === 0;
  const at = $from.depth === 0 ? to : emptyLine ? { from: $from.before(1), to: $from.after(1) } : $from.after(1);
  // Its own step in the history however soon after the last edit it comes: one Undo takes it out alone.
  editor.chain().focus().command(({ tr }) => { closeHistory(tr); return true; })
    .insertContentAt(at, { type: 'postList', attrs }).scrollIntoView().run();
}

/** The + and / menus: nothing goes in until the window is saved, and cancelling hands the caret back. */
export async function addPostList(editor: Editor, copy: AdminCopy, locale: PostLocale): Promise<void> {
  const attrs = await askForPostList(copy, locale);
  if (attrs) insertPostList(editor, attrs);
  else editor.commands.focus();
}
