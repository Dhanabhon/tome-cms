import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1, // Tests lease the shared site_settings singleton.
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4322',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4322',
    // ASTRO_DEV_BACKGROUND turns off Astro 7's agent detection, which would otherwise
    // detach the dev server and leave Playwright watching a process that has already exited.
    env: { ...process.env, ASTRO_DEV_BACKGROUND: '1', NODE_ENV: 'development', TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-playwright' },
    reuseExistingServer: true,
    timeout: 120_000,
    url: 'http://127.0.0.1:4322',
  },
});
