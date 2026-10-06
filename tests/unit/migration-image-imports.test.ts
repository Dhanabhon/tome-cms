import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';

// The runtime image copies selected sources only, and loads every migration from them. A file a
// migration imports that the Dockerfile does not copy breaks the updater, the installer and the
// migration inventory with ERR_MODULE_NOT_FOUND, and nothing else in the suite sees it.
const ENTRY_POINTS = ['src/server/db/migrator.ts', 'scripts/db-migrate.ts'];
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;

const copied = [...readFileSync('Dockerfile', 'utf8').matchAll(/^COPY --from=builder\s+(?:--chown=\S+\s+)?\/app\/(\S+)\s/gm)]
  .map((match) => match[1]!.replace(/\/$/, ''));

function resolve(from: string, specifier: string): string | undefined {
  const base = relative('.', join(dirname(from), specifier));
  return [base, `${base}.ts`, join(base, 'index.ts')].find((path) => path.endsWith('.ts') && existsSync(path));
}

function reachable(): string[] {
  const seen = new Set<string>();
  const queue = [...ENTRY_POINTS];
  for (let file = queue.pop(); file; file = queue.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    // Type-only imports are erased when tsx loads the file, so the image does not need them.
    const source = readFileSync(file, 'utf8').replace(/\b(?:import|export) type\b[^;]*;/gs, '');
    for (const [, specifier] of source.matchAll(IMPORT)) {
      const target = resolve(file, specifier!);
      if (target) queue.push(target);
    }
  }
  return [...seen].sort();
}

test('every local file the migrator can load is copied into the runtime image', () => {
  assert.ok(copied.length > 0, 'found no COPY lines in the Dockerfile');
  const files = reachable();
  assert.ok(files.includes('src/lib/slug.ts'), 'the import walk should reach slug.ts through migration 033');
  const missing = files.filter((file) => !copied.some((path) => file === path || file.startsWith(`${path}/`)));
  assert.deepEqual(missing, []);
});
