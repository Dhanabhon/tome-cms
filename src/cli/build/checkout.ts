import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * The TomeCMS source checkout holding `cwd`, or null. A checkout is a directory whose package.json
 * is named tome-cms and which has src/themes/manifests.ts. It looks from the working directory, not
 * from where tome itself is: the server's installed tome lives outside any checkout, and must say so.
 */
export function findCheckout(cwd: string): string | null {
  for (let directory = resolve(cwd); ; directory = dirname(directory)) {
    if (isCheckout(directory)) return directory;
    if (dirname(directory) === directory) return null;
  }
}

function isCheckout(directory: string): boolean {
  try {
    const name: unknown = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).name;
    return name === 'tome-cms' && existsSync(join(directory, 'src', 'themes', 'manifests.ts'));
  } catch {
    return false;
  }
}
