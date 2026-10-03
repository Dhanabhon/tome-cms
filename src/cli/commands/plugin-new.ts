import type { PluginHook } from '../args.js';
import type { applyEdits } from '../build/anchors.js';
import { create, type BuildOutput } from '../build/create.js';
import { pluginFiles } from '../build/plugin.js';

/** `tome plugin new`: a plugin that fills its hook and does nothing yet, added to the plugin lists. */
export function pluginNew(root: string, options: { id: string; hook: PluginHook; client: boolean; dryRun: boolean }, output: BuildOutput, apply?: typeof applyEdits): number {
  return create(root, 'plugin', options.id, {
    dryRun: options.dryRun,
    files: () => pluginFiles(options.id, options.hook, options.client),
    next: ['npm run dev', `Switch ${options.id} on under Plugins; it starts off.`, 'npm run tome -- check'],
    output,
    apply,
  });
}
