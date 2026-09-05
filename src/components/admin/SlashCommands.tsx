import {
  Command,
  createSuggestionItems,
  EditorCommand,
  EditorCommandEmpty,
  EditorCommandItem,
  EditorCommandList,
  renderItems,
} from 'novel';

const commandItems = createSuggestionItems([
  {
    title: 'Heading 2',
    description: 'Large section heading',
    icon: <span aria-hidden="true">H2</span>,
    searchTerms: ['section', 'subtitle'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run(),
  },
  {
    title: 'Heading 3',
    description: 'Subsection heading',
    icon: <span aria-hidden="true">H3</span>,
    searchTerms: ['section', 'subtitle'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run(),
  },
  {
    title: 'Bullet list',
    description: 'Create a simple list',
    icon: <span aria-hidden="true">•</span>,
    searchTerms: ['unordered', 'list'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: 'Code block',
    description: 'Add a code snippet',
    icon: <span aria-hidden="true">{'</>'}</span>,
    searchTerms: ['code', 'pre'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    title: 'Quote',
    description: 'Highlight a quotation',
    icon: <span aria-hidden="true">“</span>,
    searchTerms: ['blockquote', 'callout'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
]);

export const slashCommand = Command.configure({
  suggestion: {
    items: () => commandItems,
    render: renderItems,
  },
});

export default function SlashCommands() {
  return (
    <EditorCommand className="max-h-80 w-72 overflow-y-auto rounded-lg border border-line bg-white p-1.5 font-sans">
      <EditorCommandEmpty className="px-3 py-5 text-center text-sm text-muted">No commands found</EditorCommandEmpty>
      <EditorCommandList>
        {commandItems.map((item) => (
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
