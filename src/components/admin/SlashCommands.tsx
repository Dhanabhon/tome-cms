import {
  Command,
  createSuggestionItems,
  EditorCommand,
  EditorCommandEmpty,
  EditorCommandItem,
  EditorCommandList,
  renderItems,
} from 'novel';
import { useMemo } from 'react';

import type { AdminCopy } from '../../lib/admin-i18n';

const commandItems = (copy: AdminCopy) => createSuggestionItems([
  {
    title: copy.blocks.heading2,
    description: copy.blocks.heading2Hint,
    icon: <span aria-hidden="true">H2</span>,
    searchTerms: ['section', 'subtitle'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run(),
  },
  {
    title: copy.blocks.heading3,
    description: copy.blocks.heading3Hint,
    icon: <span aria-hidden="true">H3</span>,
    searchTerms: ['section', 'subtitle'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run(),
  },
  {
    title: copy.blocks.bulletList,
    description: copy.blocks.bulletListHint,
    icon: <span aria-hidden="true">•</span>,
    searchTerms: ['unordered', 'list'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: copy.blocks.codeBlock,
    description: copy.blocks.codeBlockHint,
    icon: <span aria-hidden="true">{'</>'}</span>,
    searchTerms: ['code', 'pre'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    title: copy.blocks.quote,
    description: copy.blocks.quoteHint,
    icon: <span aria-hidden="true">“</span>,
    searchTerms: ['blockquote', 'callout'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
]);

/** The menu labels depend on the owner's language, so the extension is built per editor. */
export const createSlashCommand = (copy: AdminCopy) => Command.configure({
  suggestion: {
    items: () => commandItems(copy),
    render: renderItems,
  },
});

export default function SlashCommands({ copy }: { copy: AdminCopy }) {
  // Same list the extension registers, so the menu and the '/' suggestions never disagree.
  const items = useMemo(() => commandItems(copy), [copy]);

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
