import { Mark, mergeAttributes } from '@tiptap/core';

import { isTextColor, type TextColor } from './text-colors';

export { isTextColor, TEXT_COLORS, type TextColor } from './text-colors';

/** The palette name on an element's `tome-color-*` class, or null. */
function colorOf(element: HTMLElement): TextColor | null {
  const name = [...element.classList].find((value) => value.startsWith('tome-color-'))?.slice('tome-color-'.length);
  return isTextColor(name) ? name : null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textColor: {
      setTextColor: (color: TextColor) => ReturnType;
      unsetTextColor: () => ReturnType;
    };
  }
}

/**
 * Text colour, configured once, for the editor and for the HTML the server stores.
 *
 * A name, never a value: the page gets `class="tome-color-red"`, and each theme owns the shade,
 * one for light and one for dark, so a colour chosen on a light screen stays readable on a
 * dark one. The sanitizer keeps these six classes on a span and no style at all.
 */
export const textColor = Mark.create({
  name: 'textColor',
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: colorOf,
        renderHTML: (attributes) => (isTextColor(attributes.color) ? { class: `tome-color-${attributes.color}` } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span', getAttrs: (element) => (colorOf(element) ? {} : false) }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0];
  },
  addCommands() {
    return {
      setTextColor: (color) => ({ commands }) => commands.setMark(this.name, { color }),
      unsetTextColor: () => ({ commands }) => commands.unsetMark(this.name),
    };
  },
});
