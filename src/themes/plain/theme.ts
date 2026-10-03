import type { ThemeManifest } from '../contract';

/** Kept apart from the templates so the admin can name the theme without loading it. */
export const manifest: ThemeManifest = {
  description: 'Google Sans on a wide frame, with rules in place of surfaces.',
  id: 'plain',
  leadsFirstPage: true,
  name: 'Plain',
  // 400 for the words, 700 for the headings, the chosen tab and the wordmark: both draw the first screen.
  preloadFonts: [
    '/fonts/google-sans-latin-400-normal.woff2',
    '/fonts/google-sans-thai-400-normal.woff2',
    '/fonts/google-sans-latin-700-normal.woff2',
    '/fonts/google-sans-thai-700-normal.woff2',
  ],
};
