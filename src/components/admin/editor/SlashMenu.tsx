import type { SuggestionKeyDownProps } from '@tiptap/suggestion';
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';

import type { SlashItem } from './slash-items';

export interface SlashMenuHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

interface SlashMenuProps {
  command: (item: SlashItem) => void;
  empty: string;
  items: SlashItem[];
  label: string;
}

/**
 * What '/' opens. The keys are handled here rather than by the editor, because the editor would
 * move the cursor with the same arrows.
 */
const SlashMenu = forwardRef<SlashMenuHandle, SlashMenuProps>(({ command, empty, items, label }, ref) => {
  const [chosen, setChosen] = useState(0);
  // A new query is a new list, and the first of it is what Enter should take.
  useEffect(() => setChosen(0), [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (!items.length) return false;
      if (event.key === 'ArrowUp') {
        setChosen((at) => (at - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === 'ArrowDown') {
        setChosen((at) => (at + 1) % items.length);
        return true;
      }
      if (event.key === 'Home') {
        setChosen(0);
        return true;
      }
      if (event.key === 'End') {
        setChosen(items.length - 1);
        return true;
      }
      if (event.key === 'Enter') {
        const item = items[chosen];
        if (item) command(item);
        return true;
      }
      return false;
    },
  }), [chosen, command, items]);

  return (
    <div
      aria-label={label}
      className="editor-menu max-h-80 w-72 overflow-y-auto rounded-lg border border-line bg-surface p-1.5 font-sans"
      role="listbox"
    >
      {items.length === 0 ? <p className="px-3 py-5 text-center text-sm text-muted">{empty}</p> : null}
      {items.map((item, at) => (
        <div
          aria-selected={at === chosen}
          className={`flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-left ${at === chosen ? 'bg-soft' : ''}`}
          key={item.title}
          onMouseDown={(event) => {
            // The editor keeps the cursor: a menu that took focus would lose the range.
            event.preventDefault();
            command(item);
          }}
          onMouseEnter={() => setChosen(at)}
          role="option"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line text-xs font-semibold text-ink">
            {item.icon}
          </span>
          <span>
            <span className="block text-sm font-medium text-ink">{item.title}</span>
            <span className="block text-xs text-muted">{item.description}</span>
          </span>
        </div>
      ))}
    </div>
  );
});

SlashMenu.displayName = 'SlashMenu';

export default SlashMenu;
