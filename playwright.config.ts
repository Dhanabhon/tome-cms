import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1, // Tests lease the shared site_settings singleton.
  timeout: 30_000,
  // No shared server and no baseURL: each spec stands up the server it needs, with the
  // environment that spec is about. A shared one only tied the suite to a .env.local
  // that CI does not have.
  use: {
    trace: 'retain-on-failure',
  },
  // Both projects are Chromium, and the mobile one has to stay that way: virtual WebAuthn is
  // driven over CDP, which only Chromium speaks, and CI installs only the browser the suite
  // needs. An iPhone device here is WebKit -- it ran locally, where a WebKit was already
  // downloaded, and failed in CI, where one never had been.
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
  ],
});
