import type { ThemeManifest } from '../contract';

/** Kept apart from the templates so the admin can name the theme without loading it. */
export const manifest: ThemeManifest = {
  description: 'The system font on a wide frame, with rules in place of surfaces.',
  id: 'plain',
  leadsFirstPage: true,
  name: 'Plain',
};
