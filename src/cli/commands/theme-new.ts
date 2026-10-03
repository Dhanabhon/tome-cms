import type { ThemeSource } from '../args.js';
import type { applyEdits } from '../build/anchors.js';
import { create, type BuildOutput } from '../build/create.js';
import { copyTheme } from '../build/theme.js';

/** `tome theme new`: a copy of an existing theme under a new id, added to the theme lists. */
export function themeNew(root: string, options: { id: string; from: ThemeSource; dryRun: boolean }, output: BuildOutput, apply?: typeof applyEdits): number {
  return create(root, 'theme', options.id, {
    dryRun: options.dryRun,
    files: () => copyTheme(root, options.from, options.id),
    next: ['npm run dev', `Choose ${options.id} under Appearance → Themes.`, 'npm run tome -- check'],
    output,
    apply,
  });
}
