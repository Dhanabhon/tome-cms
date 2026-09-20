import type { PluginManifest } from '../contract';

/** Kept apart from the hooks so the admin can name the plugin without loading it. */
export const manifest: PluginManifest = {
  description: {
    en: 'Opens the images in an article full size, without leaving the page.',
    th: 'เปิดรูปในบทความให้เต็มขนาดโดยไม่ต้องออกจากหน้า',
  },
  hooks: ['publicPage'],
  icon: 'media',
  id: 'lightbox',
  name: 'Image lightbox',
  settings: [],
};
