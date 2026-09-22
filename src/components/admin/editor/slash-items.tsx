import type { Editor, Range } from '@tiptap/core';
import type { ReactNode } from 'react';

import Icon from '../../Icon';
import type { AdminCopy } from '../../../lib/admin-i18n';
import { PICK_FILE_EVENT } from '../../../lib/editor-attachment';
import { NEW_TABLE } from '../../../lib/editor-table';
import { tableActions } from '../TableBubble';

export interface SlashItem {
  command: (props: { editor: Editor; range: Range }) => void;
  description: string;
  icon: ReactNode;
  searchTerms: string[];
  title: string;
}

export const commandItems = (copy: AdminCopy, inTable: boolean): SlashItem[] => [
  // Inside a table, what can be done to it comes first: this is how a keyboard reaches it.
  ...(inTable ? tableActions(copy).map((action) => ({
    title: action.label,
    description: action.hint,
    icon: <Icon name={action.icon} />,
    searchTerms: ['table', 'row', 'column'],
    command: ({ editor, range }: { editor: Editor; range: Range }) => action.run(editor.chain().focus().deleteRange(range)).run(),
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
    command: ({ editor, range }: { editor: Editor; range: Range }) => editor.chain().focus().deleteRange(range).insertTable(NEW_TABLE).run(),
  }]),
  {
    title: copy.blocks.file,
    description: copy.blocks.fileHint,
    icon: <Icon name="file" />,
    searchTerms: ['file', 'attachment', 'document', 'pdf', 'download'],
    // The picker belongs to the + menu; this asks it to open where the command was typed.
    command: ({ editor, range }: { editor: Editor; range: Range }) => {
      editor.chain().focus().deleteRange(range).run();
      editor.view.dom.dispatchEvent(new CustomEvent(PICK_FILE_EVENT));
    },
  },
];
