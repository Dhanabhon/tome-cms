import { Node } from '@tiptap/core';

import { documentLabel, formatBytes, isDocumentType, type SupportedDocumentType } from './media';

/** What a card says of its file. The server takes it from the library, never from the editor. */
export interface AttachmentFile {
  mimeType: SupportedDocumentType;
  name: string;
  size: number;
}

/** Sent on the editor's DOM to open the file picker: '/' has none of its own, and the + menu has. */
export const PICK_FILE_EVENT = 'tome:pick-file';

/** The line under a card's name: its type and its size, in no language in particular. */
export function attachmentMeta(file: Pick<AttachmentFile, 'mimeType' | 'size'>): string {
  return `${documentLabel(file.mimeType)} · ${formatBytes(file.size)}`;
}

const MEDIA_PATH = /^\/media\/([0-9a-f-]{36})$/i;

/**
 * A file in an article: one block, one link. The editor and the server share this node, so the
 * card a writer sees and the HTML a reader gets cannot drift apart.
 */
export const attachment = Node.create({
  name: 'attachment',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    // Each attribute is read from the card as a whole by the rule below, never one by one from
    // the pasted element: Tiptap would otherwise lay whatever the element carries over it.
    return {
      href: { default: null, rendered: false, parseHTML: () => null },
      mediaId: { default: null, rendered: false, parseHTML: () => null },
      mimeType: { default: null, rendered: false, parseHTML: () => null },
      name: { default: '', rendered: false, parseHTML: () => null },
      size: { default: 0, rendered: false, parseHTML: () => null },
    };
  },

  // A card that is cut and pasted goes through the editor's clipboard as HTML, and this reads it
  // back. The server fills in the rest from the library when it is saved.
  parseHTML() {
    return [{
      tag: 'p.file-card',
      // Above a paragraph's rule, which would otherwise take the <p> first.
      priority: 51,
      getAttrs: (element) => {
        const link = element.querySelector('a');
        const mediaId = MEDIA_PATH.exec(link?.getAttribute('href') ?? '')?.[1]?.toLowerCase();
        const mimeType = link?.getAttribute('type') ?? '';
        if (!mediaId || !isDocumentType(mimeType)) return false;
        return {
          href: `/media/${mediaId}`,
          mediaId,
          mimeType,
          name: element.querySelector('.file-card__name')?.textContent ?? '',
          size: Number(element.getAttribute('data-size')) || 0,
        };
      },
    }];
  },

  renderHTML({ node }) {
    const { mediaId, mimeType, name, size } = node.attrs as { href: string; mediaId: string; mimeType: SupportedDocumentType; name: string; size: number };
    // A PDF opens in the browser, so it gets a tab of its own; anything else downloads in place.
    const tab = mimeType === 'application/pdf' ? { target: '_blank', rel: 'noopener noreferrer' } : {};
    return ['p', { class: 'file-card', 'data-media-id': mediaId, 'data-size': String(size) },
      ['a', { href: `/media/${mediaId}`, type: mimeType, ...tab },
        ['span', { class: 'file-card__name' }, name],
        ' ',
        ['span', { class: 'file-card__meta' }, attachmentMeta({ mimeType, size })]]];
  },
});
