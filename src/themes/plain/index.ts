import Home from './Home.astro';
import Page from './Page.astro';
import Post from './Post.astro';
import Shell from './Shell.astro';

/**
 * The reader's own font on a wide frame, rules instead of surfaces.
 *
 * It ships to keep the contract honest: an interface with one implementation is a guess,
 * and a theme switch with one option proves nothing.
 */
export { manifest } from './theme';

export { Home, Page, Post, Shell };
