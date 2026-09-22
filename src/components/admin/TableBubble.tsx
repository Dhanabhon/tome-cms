import type { ChainedCommands, Editor } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import { useCurrentEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';

import type { AdminCopy } from '../../lib/admin-i18n';
import type { IconName } from '../../lib/icons';
import Icon from '../Icon';
import AlignButtons from './AlignButtons';

export interface TableAction {
  hint: string;
  icon: IconName;
  label: string;
  run: (chain: ChainedCommands) => ChainedCommands;
}

/**
 * What can be done to a table from inside it: from its bar with a pointer, and from '/' with
 * a keyboard, since Tab inside a table moves between cells and cannot reach the bar.
 */
export const tableActions = (copy: AdminCopy): TableAction[] => [
  { hint: copy.blocks.addRowHint, icon: 'plus', label: copy.blocks.addRow, run: (chain) => chain.addRowAfter() },
  { hint: copy.blocks.addColumnHint, icon: 'plus', label: copy.blocks.addColumn, run: (chain) => chain.addColumnAfter() },
  { hint: copy.blocks.deleteRowHint, icon: 'minus', label: copy.blocks.deleteRow, run: (chain) => chain.deleteRow() },
  { hint: copy.blocks.deleteColumnHint, icon: 'minus', label: copy.blocks.deleteColumn, run: (chain) => chain.deleteColumn() },
  { hint: copy.blocks.deleteTableHint, icon: 'trash', label: copy.blocks.deleteTable, run: (chain) => chain.deleteTable() },
];

/** The box of the table the cursor is in. */
function tableBox(editor: Editor): DOMRect {
  const { node } = editor.view.domAtPos(editor.state.selection.from);
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest('.tableWrapper')?.getBoundingClientRect() ?? new DOMRect();
}

/**
 * The table's own bar, over its top left corner rather than over the words, so it stays put
 * while the cursor moves from cell to cell.
 *
 * It takes turns with the formatting bar rather than standing beside it: a cursor in a cell,
 * or cells chosen together, bring this one; words chosen in a cell bring that one. Both at
 * once would stand over each other above the table's first row.
 */
export default function TableBubble({ copy }: { copy: AdminCopy }) {
  const { editor } = useCurrentEditor();
  if (!editor) return null;

  return (
    <BubbleMenu
      className="editor-menu rounded-md border border-line bg-surface p-1 font-sans"
      editor={editor}
      // tippy took a rect; Floating UI takes a thing that has one.
      getReferencedVirtualElement={() => ({ getBoundingClientRect: () => tableBox(editor) })}
      options={{ placement: 'top-start' }}
      pluginKey="tableBubble"
      shouldShow={({ editor: instance, state }) => instance.isEditable && instance.isActive('table')
        && (state.selection.empty || state.selection instanceof CellSelection)}
    >
      <div aria-label={copy.blocks.table} className="flex max-w-[calc(100vw-2rem)] flex-wrap" role="group">
        {tableActions(copy).map((action) => (
          <button
            className="flex h-8 items-center gap-1.5 rounded px-2 text-sm font-semibold text-ink hover:bg-soft [&_.icon]:h-4 [&_.icon]:w-4"
            key={action.label}
            onClick={() => void action.run(editor.chain().focus()).run()}
            type="button"
          >
            <Icon name={action.icon} />
            {action.label}
          </button>
        ))}
        <span aria-hidden="true" className="mx-1 w-px self-stretch bg-line" />
        <AlignButtons copy={copy} />
      </div>
    </BubbleMenu>
  );
}
