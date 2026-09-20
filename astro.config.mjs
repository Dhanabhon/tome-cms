import node from '@astrojs/node';
import react from '@astrojs/react';
import { defineConfig } from 'astro/config';

const isDev = process.env.npm_lifecycle_event === 'dev' || process.argv.includes('dev');
const isCheck = process.env.npm_lifecycle_event === 'check' || process.argv.includes('check');
const defaultViteCacheDir = `node_modules/.vite-${isDev ? 'dev' : isCheck ? 'check' : 'build'}`;

export default defineConfig({
  output: 'server',
  devToolbar: { enabled: false },
  adapter: node({ mode: 'standalone' }),
  integrations: [react()],
  vite: { cacheDir: process.env.TOME_CMS_VITE_CACHE_DIR ?? defaultViteCacheDir },
});
