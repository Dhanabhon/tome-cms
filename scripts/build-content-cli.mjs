// The content CLI (src/server/transfer/cli.ts) runs as a one-shot of the app image, which ships
// dist/ and almost none of src/. Astro's build bundles the server into chunks that cannot be
// started on their own, so the CLI is bundled here, beside them. Packages stay outside it and
// load from node_modules, as they do for the server.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/server/transfer/cli.ts'],
  outfile: 'dist/server/content-cli.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  logLevel: 'info',
});
