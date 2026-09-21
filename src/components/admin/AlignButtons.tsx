import { EditorBubbleItem, useEditor } from 'novel';

import type { AdminCopy } from '../../lib/admin-i18n';
import { alignActions } from '../../lib/editor-align';
import Icon from '../Icon';

/** Left, centre and right, for the lines chosen or the cells the cursor is in. */
export default function AlignButtons({ copy }: { copy: AdminCopy }) {
  const { editor } = useEditor();
  if (!editor) return null;

  return alignActions(copy).map((action) => {
    const active = action.active(editor);
    return (
      <EditorBubbleItem key={action.label} onSelect={(instance) => void action.run(instance.chain().focus()).run()}>
        <button
          aria-label={action.label}
          aria-pressed={active}
          className={`flex h-8 min-w-9 items-center justify-center rounded px-2 hover:bg-soft [&_.icon]:h-4 [&_.icon]:w-4 ${active ? 'bg-soft text-accent' : 'text-ink'}`}
          type="button"
        >
          <Icon name={action.icon} />
        </button>
      </EditorBubbleItem>
    );
  });
}
