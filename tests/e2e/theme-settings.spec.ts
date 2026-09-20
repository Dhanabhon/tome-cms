import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import { expect, test } from './own-worker';

/**
 * A theme is told how to draw the feed, and the feed is drawn that way.
 *
 * Six posts a load was a constant in the homepage route, with a comment explaining that six
 * ends on a full row at one, two or three cards across -- which is true of paper's grid and
 * means nothing to a one-column list. It is the theme's to say now, and this asks whether
 * saying it changes what a reader is served.
 */

test.use({ stack: 'theme-settings' });

const PROJECT = 'tomecms-theme-settings';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'theme-settings-secret-at-least-32-char';

function docker(args: string[], timeout = 180_000) {
  const result = spawnSync('docker', [...COMPOSE, ...args], { encoding: 'utf8', timeout });
  if (result.status !== 0) throw new Error(`docker ${args[0]} failed: ${result.stderr || result.stdout}`);
  return result;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No port available.'));
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

let server: ChildProcess | undefined;
let origin = '';
let serverEnv: NodeJS.ProcessEnv = {};

test.beforeAll(async () => {
  const port = await freePort();
  origin = `http://localhost:${port}`;
  serverEnv = {
    ...process.env,
    NODE_ENV: 'development',
    // Astro 7 backgrounds the dev server when it detects an agent, and a detached server is
    // one this test cannot wait on or stop.
    ASTRO_DEV_BACKGROUND: '1',
    DATABASE_URL: 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
    TOME_CMS_PUBLIC_URL: origin,
    TOME_CMS_INSTALL_TOKEN: CREDENTIAL,
    BETTER_AUTH_SECRET: CREDENTIAL,
    TOME_CMS_CONTEXT_SECRET: CREDENTIAL,
    TOME_CMS_RECOVERY_PEPPER: CREDENTIAL,
    S3_ENDPOINT: 'http://127.0.0.1:59000',
    S3_ACCESS_KEY_ID: 'tomecms_test',
    S3_SECRET_ACCESS_KEY: 'foundation-test-only',
    S3_BUCKET: 'tomecms-test-media',
    S3_REGION: 'us-east-1',
    S3_FORCE_PATH_STYLE: 'true',
    MEDIA_PUBLIC_URL: 'http://127.0.0.1:59000/tomecms-test-media/',
    TOME_CMS_FRONTEND_MODE: 'bundled',
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-theme-settings',
  };

  docker(['up', '-d', '--wait', '--wait-timeout', '90', 'postgres', 'seaweedfs']);
  // A schema of its own, so this never reads or writes whatever the last suite left behind.
  docker(['exec', '-T', 'postgres', 'psql', '--quiet', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1',
    '-U', 'tomecms_test', '-d', 'tomecms_test', '-c', 'drop schema public cascade; create schema public;'], 60_000);

  Object.assign(process.env, serverEnv);
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  await migrateToLatest();

  // An installed owner, without walking the six-step wizard: what this test is about starts
  // after there is an owner to sign in as. The installer has its own acceptance.
  const { sql } = await import('kysely');
  const { db } = await import('../../src/server/db/client');
  await sql`insert into "user" (id, name, email, "emailVerified", role, "createdAt", "updatedAt")
    values ('signin-test-owner', 'Owner', 'owner@tomecms.invalid', true, 'owner', now(), now())`.execute(db);
  await sql`insert into site_settings (id, owner_id, site_name, default_locale, timezone, admin_path)
    values (true, 'signin-test-owner', 'Select Test', 'en', 'UTC', '/admin')`.execute(db);

  await db.transaction().execute(async (trx) => {
    const category = (await sql<{ id: string }>`insert into categories (owner_id, name, is_default) values ('signin-test-owner', 'Uncategorized', true) returning id`.execute(trx)).rows[0].id;
    for (let n = 0; n < 20; n += 1) {
      const group = (await sql<{ id: string }>`insert into post_translation_groups (owner_id) values ('signin-test-owner') returning id`.execute(trx)).rows[0].id;
      await sql`insert into post_category_assignments (translation_group_id, category_id, owner_id) values (${group}::uuid, ${category}::uuid, 'signin-test-owner')`.execute(trx);
      await sql`insert into posts (translation_group_id, locale, title, slug, content_json, content_html, status, published_at, owner_id)
        values (${group}::uuid, 'en', ${`Post ${n}`}, ${`post-${n}`}, ${JSON.stringify({ type: 'doc', content: [] })}::jsonb, '<p>x</p>',
          'published', now() - (${n + 1} || ' days')::interval, 'signin-test-owner')`.execute(trx);
    }
  });

  // A cover on every post, so the hero has something to slide.
  const media = (await sql<{ id: string }>`insert into media_items
    (owner_id, folder_id, object_key, original_name, mime_type, size_bytes, width, height, checksum_sha256, alt_text, state)
    values ('signin-test-owner', null, 'seed/cover.webp', 'cover.webp', 'image/webp', 1000, 1600, 900, ${`${'a'.repeat(43)}=`}, '', 'ready') returning id`.execute(db)).rows[0].id;
  await sql`update posts set cover_media_id = ${media}::uuid`.execute(db);

  server = spawn(process.execPath, ['./node_modules/astro/bin/astro.mjs', 'dev', '--ignore-lock',
    '--host', 'localhost', '--port', String(port)], { cwd: process.cwd(), env: serverEnv, stdio: 'pipe' });
  let output = '';
  server.stdout?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  server.stderr?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Sign-in test server exited early.\n${output}`);
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) return;
    } catch {
      // Astro is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Sign-in test server never became ready.\n${output}`);
});

test.afterAll(async () => {
  server?.kill('SIGTERM');
  try {
    const { closeDatabase } = await import('../../src/server/db/client');
    await closeDatabase();
  } catch {
    // The pool may never have opened.
  }
  docker(['down', '--volumes', '--remove-orphans'], 90_000);
});


test.skip(({ isMobile }) => Boolean(isMobile), 'One browser is enough; the authenticator needs Chromium.');

test('what a theme is told is what the feed does', async ({ page }) => {
  test.setTimeout(180_000);
  const { sql: query } = await import('kysely');
  const { db } = await import('../../src/server/db/client');
  const { readThemeSettings, writeThemeSettings } = await import('../../src/server/themes/store');
  await page.setViewportSize({ width: 1440, height: 900 });

  const feed = async () => {
    await page.goto(`${origin}/en`);
    await page.locator('.post-card').first().waitFor();
    return page.evaluate(() => ({
      cards: document.querySelectorAll('.post-card').length,
      // The marker the feed script looks for. Without it there is nothing to wire.
      endless: Boolean(document.querySelector('[data-post-feed]')),
      olderLink: Boolean(document.querySelector('[data-post-next]')),
    }));
  };

  expect(await readThemeSettings('paper'), 'a theme nobody has answered gets what it declared')
    .toEqual({ gridColumns: '3', hero: 'text', heroHeadline: '', infiniteScroll: 'on', postsPerLoad: '6' });
  expect(await feed()).toEqual({ cards: 6, endless: true, olderLink: true });

  await writeThemeSettings('signin-test-owner', { id: 'paper', values: { postsPerLoad: '12' } });
  expect(await feed(), 'the page holds what the theme was told to hold').toEqual({ cards: 12, endless: true, olderLink: true });

  await writeThemeSettings('signin-test-owner', { id: 'paper', values: { infiniteScroll: 'off' } });
  expect(await feed(), 'off leaves the link a reader without JavaScript already follows')
    .toEqual({ cards: 12, endless: false, olderLink: true });
  expect((await readThemeSettings('paper')).postsPerLoad, 'writing one control does not clear the other').toBe('12');

  await expect(
    writeThemeSettings('signin-test-owner', { id: 'paper', values: { postsPerLoad: '7' } }),
    'a value the theme does not offer is refused',
  ).rejects.toThrow(/does not offer/);

  // A row edited by hand, or a release that dropped a choice, must not reach a template.
  await query`update site_settings set theme_settings = '{"paper":{"postsPerLoad":"99"}}'::jsonb`.execute(db);
  expect(await readThemeSettings('paper'), 'a stored value the theme no longer offers is not a value')
    .toEqual({ gridColumns: '3', hero: 'text', heroHeadline: '', infiniteScroll: 'on', postsPerLoad: '6' });
});

test('how many cards go across is asked for, not fixed', async ({ page }) => {
  test.setTimeout(180_000);
  const { writeThemeSettings } = await import('../../src/server/themes/store');

  const across = async () => {
    await page.goto(`${origin}/en`);
    await page.locator('.post-card').first().waitFor();
    return page.evaluate(() => {
      // Cards the feed holds for the next row are hidden, and a hidden box reads 0 -- count
      // those and every card looks like it is in column one.
      // offsetTop, not a client rect: the cards slide in, and a rect read mid-animation puts
      // every staggered card on a row of its own.
      const shown = [...document.querySelectorAll('.post-card')].filter((card) => (card as HTMLElement).offsetParent !== null) as HTMLElement[];
      const top = Math.min(...shown.map((card) => card.offsetTop));
      return shown.filter((card) => card.offsetTop === top).length;
    });
  };

  const seen: Record<string, number[]> = {};
  for (const choice of ['2', '3', '4']) {
    await writeThemeSettings('signin-test-owner', { id: 'paper', values: { gridColumns: choice } });
    seen[choice] = [];
    for (const width of [1440, 1024, 375]) {
      await page.setViewportSize({ width, height: 900 });
      seen[choice].push(await across());
    }
  }

  // Asked for at the widest, and fewer wherever that many cannot be read.
  expect(seen['2'], 'two across').toEqual([2, 2, 1]);
  expect(seen['3'], 'three across, which is what the grid did before it could be asked').toEqual([3, 3, 1]);
  // Four only fits the 80rem page, and only because choosing it also lowers the floor.
  expect(seen['4'], 'four where there is room, and never on a phone').toEqual([4, 3, 1]);
});

test('the hero is the owner\'s, in the language the page is read in', async ({ page }) => {
  test.setTimeout(180_000);
  const { writeThemeSettings } = await import('../../src/server/themes/store');
  const hero = async (path: string) => {
    await page.goto(`${origin}${path}`);
    await page.locator('.site-header').waitFor();
    return page.evaluate(() => {
      const band = document.querySelector('.home-hero') as HTMLElement | null;
      const title = band?.querySelector('.hero-title') as HTMLElement | null;
      return {
        shown: Boolean(band),
        moving: band?.dataset.hero ?? null,
        headline: title?.textContent?.trim() ?? null,
        animation: title ? getComputedStyle(title).animationName : 'none',
        // A headline with no break opportunity has to break anyway.
        overflows: title ? title.scrollWidth > title.clientWidth + 1 : false,
      };
    });
  };
  await page.setViewportSize({ width: 1440, height: 900 });

  // It was one English sentence written into the template, so a Thai reader met it in English.
  expect((await hero('/en')).headline).toBe('Ideas, carefully published.');
  expect((await hero('/th')).headline, 'the Thai page says it in Thai').toBe('เขียนไว้อย่างตั้งใจ เผยแพร่อย่างพิถีพิถัน');

  await writeThemeSettings('signin-test-owner', { id: 'paper', values: { heroHeadline: 'ทดสอบหัวข้อของเจ้าของ' } });
  expect((await hero('/th')).headline, "and the owner's words win").toBe('ทดสอบหัวข้อของเจ้าของ');
  await expect(
    writeThemeSettings('signin-test-owner', { id: 'paper', values: { heroHeadline: 'x'.repeat(61) } }),
    'a length is refused as a length, not as a choice',
  ).rejects.toThrow(/longer than 60/);

  // Sixty of the same letter is not a headline, but it must not run out of the band either.
  await writeThemeSettings('signin-test-owner', { id: 'paper', values: { heroHeadline: 'W'.repeat(60) } });
  expect((await hero('/en')).overflows, 'an unbreakable headline breaks anyway').toBe(false);

  await writeThemeSettings('signin-test-owner', { id: 'paper', values: { hero: 'animated', heroHeadline: '' } });
  expect(await hero('/en')).toMatchObject({ shown: true, moving: 'moving', animation: 'post-card-in' });

  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect((await hero('/en')).animation, 'a reader who asked for less motion gets none').toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  await writeThemeSettings('signin-test-owner', { id: 'paper', values: { hero: 'off' } });
  expect(await hero('/en')).toMatchObject({ shown: false, headline: null });
  await writeThemeSettings('signin-test-owner', { id: 'paper', values: { hero: 'text' } });
});

test('the hero of covers rotates, and lets itself be stopped', async ({ page }) => {
  test.setTimeout(180_000);
  const { writeThemeSettings } = await import('../../src/server/themes/store');
  await page.setViewportSize({ width: 1440, height: 900 });
  await writeThemeSettings('signin-test-owner', { id: 'paper', values: { hero: 'slider' } });

  const asked: string[] = [];
  const listen = (request: { resourceType: () => string; url: () => string }) => {
    if (request.resourceType() === 'script') asked.push(request.url());
  };
  page.on('request', listen);
  await page.goto(`${origin}/en`, { waitUntil: 'networkidle' });
  page.off('request', listen);
  expect(asked.some((url) => url.includes('hero-slider')), 'the rotation arrives only where there is one').toBe(true);

  expect(await page.evaluate(() => {
    const slides = [...document.querySelectorAll('[data-hero-slide]')];
    const image = (at: number) => slides[at]?.querySelector('img');
    return {
      slides: slides.length,
      carousel: document.querySelector('[data-hero-slider]')?.getAttribute('aria-roledescription'),
      // The first slide is the page's largest paint; the rest are not asked for yet.
      first: [image(0)?.getAttribute('loading'), image(0)?.getAttribute('fetchpriority')],
      rest: [image(1)?.getAttribute('loading'), image(1)?.getAttribute('fetchpriority')],
      slideLabel: slides[0]?.getAttribute('aria-label'),
    };
  })).toEqual({
    slides: 5,
    carousel: 'carousel',
    first: ['eager', 'high'],
    rest: ['lazy', null],
    slideLabel: 'Image 1 of 5',
  });

  const toggle = () => page.evaluate(() => {
    const button = document.querySelector('[data-hero-toggle]') as HTMLElement;
    return { label: button.getAttribute('aria-label'), state: button.dataset.state };
  });
  expect(await toggle(), 'it rotates, and says how to stop it').toEqual({ label: 'Stop rotating the images', state: 'rotating' });

  await page.locator('[data-hero-next]').click();
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => {
    const track = document.querySelector('[data-hero-track]') as HTMLElement;
    return Math.round(track.scrollLeft / track.clientWidth);
  }), 'and steps when asked').toBe(1);

  await page.locator('[data-hero-toggle]').click();
  expect(await toggle()).toEqual({ label: 'Start rotating the images', state: 'still' });

  // A carousel that rotates at a reader who asked for less motion is the reason carousels
  // have the reputation they have.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload({ waitUntil: 'networkidle' });
  expect((await toggle()).state, 'it never starts for a reader who asked for less motion').toBe('still');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // And a band with nothing to show is not a band.
  const { sql: query } = await import('kysely');
  const { db } = await import('../../src/server/db/client');
  await query`update posts set cover_media_id = null`.execute(db);
  await page.goto(`${origin}/en`);
  expect(await page.evaluate(() => ({
    slider: Boolean(document.querySelector('[data-hero-slider]')),
    text: Boolean(document.querySelector('.home-hero .hero-title')),
  })), 'no covers falls back to text rather than standing empty').toEqual({ slider: false, text: true });
  await query`update posts set cover_media_id = (select id from media_items limit 1)`.execute(db);
  await writeThemeSettings('signin-test-owner', { id: 'paper', values: { hero: 'text' } });
});

test('the cards slide in, and never at the cost of the first paint', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/en`);
  await page.locator('.post-card').first().waitFor();

  expect(await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.post-card')].slice(0, 3) as HTMLElement[];
    return cards.map((card) => {
      const style = getComputedStyle(card);
      return { name: style.animationName, delay: style.animationDelay, index: card.style.getPropertyValue('--card-index').trim() };
    });
  }), 'each card follows the one before it').toEqual([
    { name: 'post-card-slide', delay: '0s', index: '0' },
    { name: 'post-card-slide', delay: '0.06s', index: '1' },
    { name: 'post-card-slide', delay: '0.12s', index: '2' },
  ]);

  // Opacity is the part that would cost the largest contentful paint, so the slide has none
  // of it: an element at opacity 0 has not been painted, and LCP waits for paint.
  const keyframes = await page.evaluate(() => {
    for (const sheet of [...document.styleSheets]) {
      let rules: CSSRule[];
      try { rules = [...sheet.cssRules]; } catch { continue; }
      for (const rule of rules) {
        if (rule instanceof CSSKeyframesRule && rule.name === 'post-card-slide') return rule.cssText;
      }
    }
    return 'not found';
  });
  expect(keyframes, 'the reveal moves, it does not fade').toMatch(/translateY/);
  expect(keyframes).not.toMatch(/opacity/);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await page.locator('.post-card').first().waitFor();
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.post-card')!).animationName),
    'a reader who asked for less motion gets none').toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
});

test('a reader is not served the feed they switched off', async ({ page }) => {
  test.setTimeout(180_000);
  const { writeThemeSettings } = await import('../../src/server/themes/store');

  /** Whether the feed's own module was fetched, which a static import makes unconditional. */
  const fetchesFeed = async () => {
    const asked: string[] = [];
    const listen = (request: { resourceType: () => string; url: () => string }) => {
      if (request.resourceType() === 'script') asked.push(request.url());
    };
    page.on('request', listen);
    await page.goto(`${origin}/en`, { waitUntil: 'networkidle' });
    page.off('request', listen);
    return asked.some((url) => url.includes('post-feed'));
  };

  await writeThemeSettings('signin-test-owner', { id: 'paper', values: { infiniteScroll: 'on' } });
  expect(await fetchesFeed(), 'on: the feed arrives').toBe(true);

  await writeThemeSettings('signin-test-owner', { id: 'paper', values: { infiniteScroll: 'off' } });
  // It was fetched in both states until the import became dynamic: the page's own script
  // carried the feed's code, so switching the setting off changed the markup and not the
  // bytes. This fails if a static import comes back.
  expect(await fetchesFeed(), 'off: and does not').toBe(false);
});
