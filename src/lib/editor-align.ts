import type { ChainedCommands, Editor } from '@tiptap/core';
import { TextAlign } from '@tiptap/extension-text-align';

import type { AdminCopy } from './admin-i18n';
import type { IconName } from './icons';

/**
 * Alignment, configured once, for the editor and for the HTML the server stores. A table cell
 * is aligned through the paragraphs in it.
 *
 * Not justified: Thai puts no spaces between its words, so a justified Thai line has only its
 * letters to stretch apart.
 */
export const textAlign = TextAlign.configure({ alignments: ['left', 'center', 'right'], types: ['heading', 'paragraph'] });

export interface AlignAction {
  active: (editor: Editor) => boolean;
  icon: IconName;
  label: string;
  run: (chain: ChainedCommands) => ChainedCommands;
}

/**
 * The three alignments, as buttons on the formatting bar and on a table's bar. Left is no
 * alignment at all -- the one a line has anyway -- so choosing it clears whatever was set, and
 * it is the one pressed when nothing is.
 */
export const alignActions = (copy: AdminCopy): AlignAction[] => [
  {
    active: (editor) => !editor.isActive({ textAlign: 'center' }) && !editor.isActive({ textAlign: 'right' }),
    icon: 'alignLeft',
    label: copy.blocks.alignLeft,
    run: (chain) => chain.unsetTextAlign(),
  },
  {
    active: (editor) => editor.isActive({ textAlign: 'center' }),
    icon: 'alignCenter',
    label: copy.blocks.alignCenter,
    run: (chain) => chain.setTextAlign('center'),
  },
  {
    active: (editor) => editor.isActive({ textAlign: 'right' }),
    icon: 'alignRight',
    label: copy.blocks.alignRight,
    run: (chain) => chain.setTextAlign('right'),
  },
];
