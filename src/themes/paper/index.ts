import type { ThemeManifest } from '../contract';

import Home from './Home.astro';
import Page from './Page.astro';
import Post from './Post.astro';
import Shell from './Shell.astro';

/**
 * The site as TomeCMS ships it: paper surfaces, hairline rules, one icon set.
 *
 * Named rather than called "default" because a default is a fallback, and this is a design.
 */
export const manifest: ThemeManifest = {
  description: 'Paper surfaces and hairline rules: the look TomeCMS ships with.',
  id: 'paper',
  name: 'Paper',
};

export { Home, Page, Post, Shell };
