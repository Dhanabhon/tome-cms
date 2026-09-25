#!/usr/bin/env node
/**
 * Proves the built site's search finds a Thai word and an English one.
 *
 * Thai has no spaces between words, so it is the language a search index is most likely to get
 * wrong, and nothing else in the build would notice. Run it after `npm run build --prefix
 * website`: `npm run docs:check-search`.
 *
 * It starts its own preview server and stops it before it exits. A server already on the port
 * could be serving an older build, so the check refuses to run beside one.
 */
import { spawn } from 'node:child_process';

import { chromium } from 'playwright';

const PORT = 4331;
const ORIGIN = `http://localhost:${PORT}`;
const CASES = [
  { path: '/tome-cms/th/', word: 'เอกสาร' },
  { path: '/tome-cms/', word: 'documentation' },
];

async function answers(url) {
  try {
    await fetch(url);
    return true;
  } catch {
    return false;
  }
}

/** Stops the server and waits until it has gone, so the port is free when this exits. */
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await exited;
}

if (await answers(ORIGIN)) {
  console.error(`Something already answers on port ${PORT}. Stop it first (from website/: npx astro preview stop).`);
  process.exit(1);
}

// Astro itself, not npx, so the child killed below is the server. --ignore-lock keeps it in the
// foreground: without it, astro preview moves itself to the background when it detects an agent.
const preview = spawn(process.execPath, ['./node_modules/astro/bin/astro.mjs', 'preview', '--port', String(PORT), '--ignore-lock'], {
  cwd: new URL('..', import.meta.url),
  stdio: 'ignore',
});
try {
  for (let attempt = 0; ; attempt += 1) {
    if (preview.exitCode !== null) throw new Error('The preview server exited before it answered.');
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
  await stop(preview);
}
