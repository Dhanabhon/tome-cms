// The Markdown parse runs in a worker thread (src/server/content/markdown-import-run.ts), and a
// worker needs a file of its own. Astro's build bundles the server into chunks that cannot be
// started on their own, so the worker is bundled here, beside them. Packages stay outside it and
// load from node_modules, as they do for the server.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/server/content/markdown-parse-worker.ts'],
  outfile: 'dist/server/markdown-parse-worker.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  logLevel: 'info',
});
