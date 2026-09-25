#!/usr/bin/env node
/**
 * Proves the built site's search finds a Thai word and an English one.
 *
 * Thai has no spaces between words, so it is the language a search index is most likely to get
 * wrong, and nothing else in the build would notice. Run it after `npm run build --prefix
 * website`: `npm run docs:check-search`.
 */
import { spawn } from 'node:child_process';

import { chromium } from 'playwright';

const PORT = 4331;
const ORIGIN = `http://localhost:${PORT}`;
const CASES = [
  { path: '/tome-cms/th/', word: 'เอกสาร' },
  { path: '/tome-cms/', word: 'documentation' },
];

const preview = spawn('npx', ['astro', 'preview', '--port', String(PORT)], {
  cwd: new URL('..', import.meta.url),
  stdio: 'ignore',
});
try {
  for (let attempt = 0; ; attempt += 1) {
    try {
      if ((await fetch(`${ORIGIN}/tome-cms/`)).ok) break;
    } catch {
      // The preview server is still starting.
    }
    if (attempt > 60) throw new Error('The preview server never answered.');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const browser = await chromium.launch();
  try {
    for (const { path, word } of CASES) {
      const page = await browser.newPage();
      await page.goto(`${ORIGIN}${path}`);
      await page.locator('site-search button[data-open-modal]').click();
      await page.locator('#starlight__search input').fill(word);
      const results = page.locator('.pagefind-ui__result');
      await results.first().waitFor({ timeout: 10_000 }).catch(() => undefined);
      const count = await results.count();
      if (!count) throw new Error(`Searching ${path} for "${word}" found nothing.`);
      console.log(`${path}: "${word}" found on ${count} page(s).`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
} finally {
  preview.kill('SIGTERM');
}
