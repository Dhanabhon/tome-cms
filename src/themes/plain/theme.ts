import type { ThemeManifest } from '../contract';

/** Kept apart from the templates so the admin can name the theme without loading it. */
export const manifest: ThemeManifest = {
  description: 'One column and the system font, with rules in place of surfaces.',
  id: 'plain',
  name: 'Plain',
};
