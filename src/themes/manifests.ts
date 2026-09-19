import { manifest as paper } from './paper/theme';
import { manifest as plain } from './plain/theme';
import type { ThemeManifest } from './contract';

/**
 * What the admin needs to offer a choice: a name and a sentence, and nothing that would
 * drag a theme's templates or stylesheet into the screen doing the offering.
 */
export const THEME_MANIFESTS: readonly ThemeManifest[] = [paper, plain];
