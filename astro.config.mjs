import node from '@astrojs/node';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'server',
  devToolbar: { enabled: false },
  adapter: node({ mode: 'standalone' }),
  integrations: [react(), tailwind()],
});
