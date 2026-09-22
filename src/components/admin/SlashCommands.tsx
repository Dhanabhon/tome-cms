import type { Range } from '@tiptap/core';
import {
  Command,
  createSuggestionItems,
  EditorCommand,
  EditorCommandEmpty,
  EditorCommandItem,
  EditorCommandList,
  type EditorInstance,
  renderItems,
  useEditor,
} from 'novel';
import { useMemo } from 'react';

import Icon from '../Icon';
import type { AdminCopy } from '../../lib/admin-i18n';
import { PICK_FILE_EVENT } from '../../lib/editor-attachment';
import { NEW_TABLE } from '../../lib/editor-table';
import { tableActions } from './TableBubble';

const commandItems = (copy: AdminCopy, inTable: boolean) => createSuggestionItems([
  // Inside a table, what can be done to it comes first: this is how a keyboard reaches it.
  ...(inTable ? tableActions(copy).map((action) => ({
    title: action.label,
    description: action.hint,
    icon: <Icon name={action.icon} />,
    searchTerms: ['table', 'row', 'column'],
    command: ({ editor, range }: { editor: EditorInstance; range: Range }) => action.run(editor.chain().focus().deleteRange(range)).run(),
  })) : []),
  {
    title: copy.blocks.heading2,
    description: copy.blocks.heading2Hint,
    icon: <Icon name="heading2" />,
    searchTerms: ['section', 'subtitle'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run(),
  },
  {
    title: copy.blocks.heading3,
    description: copy.blocks.heading3Hint,
    icon: <Icon name="heading3" />,
    searchTerms: ['section', 'subtitle'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run(),
  },
  {
    title: copy.blocks.bulletList,
    description: copy.blocks.bulletListHint,
    icon: <Icon name="list" />,
    searchTerms: ['unordered', 'list'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: copy.blocks.codeBlock,
    description: copy.blocks.codeBlockHint,
    icon: <Icon name="code" />,
    searchTerms: ['code', 'pre'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    title: copy.blocks.quote,
    description: copy.blocks.quoteHint,
    icon: <Icon name="quote" />,
    searchTerms: ['blockquote', 'callout'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  // Not inside a table: a table in a cell is one nobody meant to make.
  ...(inTable ? [] : [{
    title: copy.blocks.table,
    description: copy.blocks.tableHint,
    icon: <Icon name="table" />,
    searchTerms: ['table', 'grid', 'rows', 'columns'],
    command: ({ editor, range }: { editor: EditorInstance; range: Range }) => editor.chain().focus().deleteRange(range).insertTable(NEW_TABLE).run(),
  }]),
  {
    title: copy.blocks.file,
    description: copy.blocks.fileHint,
    icon: <Icon name="file" />,
    searchTerms: ['file', 'attachment', 'document', 'pdf', 'download'],
    // The picker belongs to the + menu; this asks it to open where the command was typed.
    command: ({ editor, range }: { editor: EditorInstance; range: Range }) => {
      editor.chain().focus().deleteRange(range).run();
      editor.view.dom.dispatchEvent(new CustomEvent(PICK_FILE_EVENT));
    },
  },
]);

/** The menu labels depend on the owner's language, so the extension is built per editor. */
export const createSlashCommand = (copy: AdminCopy) => Command.configure({
  suggestion: {
    items: ({ editor }: { editor: EditorInstance }) => commandItems(copy, editor.isActive('table')),
    render: renderItems,
  },
});

export default function SlashCommands({ copy }: { copy: AdminCopy }) {
  // Same list the extension registers, so the menu and the '/' suggestions never disagree.
  const { editor } = useEditor();
  const inTable = editor?.isActive('table') ?? false;
  const items = useMemo(() => commandItems(copy, inTable), [copy, inTable]);

  return (
    <EditorCommand className="max-h-80 w-72 overflow-y-auto rounded-lg border border-line bg-surface p-1.5 font-sans">
      <EditorCommandEmpty className="px-3 py-5 text-center text-sm text-muted">{copy.blocks.noCommands}</EditorCommandEmpty>
      <EditorCommandList>
        {items.map((item) => (
          <EditorCommandItem
            className="flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-left aria-selected:bg-soft"
            key={item.title}
            onCommand={(value) => item.command?.(value)}
            value={item.title}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line text-xs font-semibold text-ink">
              {item.icon}
            </span>
            <span>
              <span className="block text-sm font-medium text-ink">{item.title}</span>
              <span className="block text-xs text-muted">{item.description}</span>
            </span>
          </EditorCommandItem>
        ))}
      </EditorCommandList>
    </EditorCommand>
  );
}
