import type { ThemeManifest } from '../contract';

/** Kept apart from the templates so the admin can name the theme without loading it. */
export const manifest: ThemeManifest = {
  description: 'Google Sans on a wide frame, with rules in place of surfaces.',
  id: 'plain',
  leadsFirstPage: true,
  name: 'Plain',
  preloadFonts: ['/fonts/google-sans-latin-400-normal.woff2', '/fonts/google-sans-thai-400-normal.woff2'],
};
