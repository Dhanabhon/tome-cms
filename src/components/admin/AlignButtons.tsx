import { useCurrentEditor, useEditorState } from '@tiptap/react';

import type { AdminCopy } from '../../lib/admin-i18n';
import { alignActions } from '../../lib/editor-align';
import Icon from '../Icon';

/** Left, centre and right, for the lines chosen or the cells the cursor is in. */
export default function AlignButtons({ copy }: { copy: AdminCopy }) {
  const { editor } = useCurrentEditor();
  const actions = alignActions(copy);
  const active = useEditorState({
    editor,
    selector: ({ editor: instance }) => actions.map((action) => (instance ? action.active(instance) : false)),
  });
  if (!editor || !active) return null;

  return actions.map((action, at) => (
    <button
      aria-label={action.label}
      aria-pressed={active[at]}
      className={`flex h-8 min-w-9 items-center justify-center rounded px-2 hover:bg-soft [&_.icon]:h-4 [&_.icon]:w-4 ${active[at] ? 'bg-soft text-accent' : 'text-ink'}`}
      key={action.label}
      onClick={() => void action.run(editor.chain().focus()).run()}
      type="button"
    >
      <Icon name={action.icon} />
    </button>
  ));
}
