import { Extension } from '@tiptap/core';
import { ReactRenderer } from '@tiptap/react';
import Suggestion from '@tiptap/suggestion';

import type { AdminCopy } from '../../../lib/admin-i18n';
import SlashMenu, { type SlashMenuHandle } from './SlashMenu';
import { commandItems, type SlashItem } from './slash-items';

/** The menu's labels follow the owner's language, so the extension is built per editor. */
export const createSlashCommand = (copy: AdminCopy) => Extension.create({
  name: 'slashCommand',
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        char: '/',
        command: ({ editor, props, range }) => props.command({ editor, range }),
        editor: this.editor,
        items: ({ editor, query }) => {
          const asked = query.trim().toLowerCase();
          return commandItems(copy, editor.isActive('table')).filter((item) => !asked
            || item.title.toLowerCase().includes(asked)
            || item.searchTerms.some((term) => term.includes(asked)));
        },
        render: () => {
          let menu: ReactRenderer<SlashMenuHandle> | null = null;
          let unmount: (() => void) | undefined;

          return {
            onStart: (props) => {
              menu = new ReactRenderer(SlashMenu, {
                editor: props.editor,
                props: { command: props.command, empty: copy.blocks.noCommands, items: props.items, label: copy.blocks.insertBlock },
              });
              unmount = props.mount(menu.element);
            },
            onUpdate: (props) => {
              menu?.updateProps({ command: props.command, empty: copy.blocks.noCommands, items: props.items, label: copy.blocks.insertBlock });
            },
            onKeyDown: (props) => menu?.ref?.onKeyDown(props) ?? false,
            onExit: () => {
              unmount?.();
              unmount = undefined;
              menu?.destroy();
              menu = null;
            },
          };
        },
      }),
    ];
  },
});
