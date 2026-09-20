/**
 * Each plugin's browser code, as a chunk of its own.
 *
 * A glob of dynamic imports, the way the themes are reached: nothing here is in the page's
 * own script, so a plugin that is off costs a reader nothing. The key is the plugin's id,
 * which is also its directory -- a plugin cannot name a URL here, because a module running
 * on every reader's page is ours and not a third party's.
 */
const CLIENTS = import.meta.glob<{ default: (mount: HTMLElement) => void }>('./*/client.ts');

export function pluginClient(id: string) {
  return CLIENTS[`./${id}/client.ts`] ?? null;
}
