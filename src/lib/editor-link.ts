import Link from '@tiptap/extension-link';

/**
 * TomeCMS's link: Tiptap's, which also remembers the File Manager file it points at. The library
 * decides whether a file is still in use by reading `mediaId` out of the stored JSON, and an
 * address alone would leave a linked file free to be deleted.
 */
export const linkWithFile = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      mediaId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-media-id'),
        renderHTML: (attributes) => (attributes.mediaId ? { 'data-media-id': attributes.mediaId } : {}),
      },
    };
  },
});
