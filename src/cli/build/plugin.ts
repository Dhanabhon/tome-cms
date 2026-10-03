import type { PluginHook } from '../args.js';

// What `tome plugin new` writes: a plugin that fills its hook and does nothing yet. Every method
// is typed by the contract itself (`Plugin['siteNotice']`), so its shape is src/plugins/contract.ts's
// and the build says so if the two drift. Each answers what the core reads as "nothing here".

/** A file of the new plugin: its path inside the plugin's directory, and its text. */
export interface PluginFile {
  path: string;
  text: string;
}

/** The methods each hook adds to the sign-in pair every plugin answers, each with its harmless answer. */
const HOOK_METHODS: Record<PluginHook, string[]> = {
  publicPage: [
    '/** The band across the top of the page: null shows none. See SiteNotice in contract.ts. */',
    "export const siteNotice: NonNullable<Plugin['siteNotice']> = () => null;",
  ],
  signIn: [],
  editorSuggestions: [
    '/**',
    ' * How likely the article belongs under each category, by id: none, so nothing is suggested.',
    ' * Once the plugin is switched on, the editor shows its suggestion button, which answers that',
    ' * nothing fits until this is written.',
    ' */',
    "export const categoryLikelihoods: NonNullable<Plugin['categoryLikelihoods']> = async () => ({});",
  ],
};

const CLIENT_METHOD = [
  '/** Whether client.ts runs on this page, and the data-* it is handed: null runs it nowhere. Return {} to run it. */',
  "export const publicClient: NonNullable<Plugin['publicClient']> = () => null;",
];

const CLIENT = `/**
 * This plugin's code in the reader's browser, in a chunk of its own. It runs on a page only where
 * publicClient in index.ts answers, and is handed the element the core put there for it, which
 * carries publicClient's dataset as data-* attributes.
 */
export default function wire(mount: HTMLElement): void {
  mount.remove();
}
`;

/** The new plugin `id`'s files, filling `hook`, and with browser code when `client`. */
export function pluginFiles(id: string, hook: PluginHook, client: boolean): PluginFile[] {
  // Browser code acts on a public page, so a plugin that has it says so, whatever else it does.
  const hooks = client && hook !== 'publicPage' ? [hook, 'publicPage'] : [hook];
  const methods = [...HOOK_METHODS[hook], ...(client ? CLIENT_METHOD : [])];
  const names = [...methods.flatMap((line) => /^export const (\w+)/.exec(line)?.[1] ?? []), 'signInWidget', 'verifySignIn'].sort();
  const index = [
    "import type { Plugin } from '../contract';",
    '',
    "export { manifest } from './plugin';",
    '',
    hook === 'signIn'
      ? '/** The widget the sign-in form draws, and the check of its answer: none yet, so every sign-in passes. */'
      : '/** Every plugin answers the sign-in pair. This one adds nothing to the sign-in and guards nothing. */',
    "export const signInWidget: Plugin['signInWidget'] = () => null;",
    "export const verifySignIn: Plugin['verifySignIn'] = async () => ({ outcome: 'passed' });",
    ...methods.flatMap((line) => (line.startsWith('/**') ? ['', line] : [line])),
    '',
    `const plugin: Plugin = { ${names.join(', ')} };`,
    'export default plugin;',
    '',
  ].join('\n');
  const manifest = `import type { PluginManifest } from '../contract';

/** Kept apart from the hooks so the admin can name the plugin without loading it. */
export const manifest: PluginManifest = {
  description: { en: '${id}', th: '${id}' },
  hooks: [${hooks.map((each) => `'${each}'`).join(', ')}],
  icon: 'plugins',
  id: '${id}',
  name: '${id}',
  settings: [],
};
`;
  return [
    ...(client ? [{ path: 'client.ts', text: CLIENT }] : []),
    { path: 'index.ts', text: index },
    { path: 'plugin.ts', text: manifest },
  ];
}
