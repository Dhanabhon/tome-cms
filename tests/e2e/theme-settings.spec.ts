import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import { expect, test } from './own-worker';
import { clearPageCache, signInOwner, type Owner } from './page-cache-reset';

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
let owner: Owner | undefined;
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
        values (${group}::uuid, 'en', ${`Post ${n}`}, ${`post-${n}`}, ${JSON.stringify({ type: 'doc', content: [] })}::jsonb, ${'<p>Body line.</p>'.repeat(200)},
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

// The owner, signed in once, for the writes that clear the page cache: see page-cache-reset.
test.beforeAll(async ({ browser }) => {
  owner = await signInOwner(browser, origin, 'signin-test-owner');
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
    .toEqual({ authorLinks: 'text', gridColumns: '3', hero: 'text', heroEvery: '6', heroHeadline: '', heroMove: 'slide', heroTurn: 'on', infiniteScroll: 'on', postsPerLoad: '6', readingProgress: 'off', stickyHeader: 'off' });
  expect(await feed()).toEqual({ cards: 6, endless: true, olderLink: true });

  await writeThemeSettings('signin-test-owner', { id: 'paper', values: { postsPerLoad: '12' } });
  clearPageCache(owner);
  expect(await feed(), 'the page holds what the theme was told to hold').toEqual({ cards: 12, endless: true, olderLink: true });

  await writeThemeSettings('signin-test-owner', { id: 'paper', values: { infiniteScroll: 'off' } });
  clearPageCache(owner);
  expect(await feed(), 'off leaves the link a reader without JavaScript already follows')
    .toEqual({ cards: 12, endless: false, olderLink: true });
  expect((await readThemeSettings('paper')).postsPerLoad, 'writing one control does not clear the other').toBe('12');

  await expect(
    writeThemeSettings('signin-test-owner', { id: 'paper', values: { postsPerLoad: '7' } }),
    'a value the theme does not offer is refused',
  ).rejects.toThrow(/does not offer/);

  // A row edited by hand, or a release that dropped a choice, must not reach a template.
  await query`update site_settings set theme_settings = '{"paper":{"postsPerLoad":"99"}}'::jsonb`.execute(db);
  clearPageCache(owner);
  expect(await readThemeSettings('paper'), 'a stored value the theme no longer offers is not a value')
    .toEqual({ authorLinks: 'text', gridColumns: '3', hero: 'text', heroEvery: '6', heroHeadline: '', heroMove: 'slide', heroTurn: 'on', infiniteScroll: 'on', postsPerLoad: '6', readingProgress: 'off', stickyHeader: 'off' });
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
    clearPageCache(owner);
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
  clearPageCache(owner);
  expect((await hero('/th')).headline, "and the owner's words win").toBe('ทดสอบหัวข้อของเจ้าของ');
  await expect(
    writeThemeSettings('signin-test-owner', { id: 'paper', values: { heroHeadline: 'x'.repeat(61) } }),
    'a length is refused as a length, not as a choice',
  ).rejects.toThrow(/longer than 60/);

  // Sixty of the same letter is not a headline, but it must not run out of the band either.
  await writeThemeSettings('signin-test-owner', { id: 'paper', values: { heroHeadline: 'W'.repeat(60) } });
  clearPageCache(owner);
  expect((await hero('/en')).overflows, 'an unbreakable headline breaks anyway').toBe(false);

  await writeThemeSettings('signin-test-owner', { id: 'paper', values: { hero: 'animated', heroHeadline: '' } });
  clearPageCache(owner);
  expect(await hero('/en')).toMatchObject({ shown: true, moving: 'moving', animation: 'post-card-in' });

  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect((await hero('/en')).animation, 'a reader who asked for less motion gets none').toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  await writeThemeSettings('signin-test-owner', { id: 'paper', values: { hero: 'off' } });
  clearPageCache(owner);
  expect(await hero('/en')).toMatchObject({ shown: false, headline: null });
  await writeThemeSettings('signin-test-owner', { id: 'paper', values: { hero: 'text' } });
  clearPageCache(owner);
});

test('the hero of covers rotates, and lets itself be stopped', async ({ page }) => {
  test.setTimeout(180_000);
  const { writeThemeSettings } = await import('../../src/server/themes/store');
  await page.setViewportSize({ width: 1440, height: 900 });
  await writeThemeSettings('signin-test-owner', { id: 'paper', values: { hero: 'slider' } });
  clearPageCache(owner);

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
    rest: ['lazy', 'low'],
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
  clearPageCache(owner);
  await page.goto(`${origin}/en`);
  expect(await page.evaluate(() => ({
    slider: Boolean(document.querySelector('[data-hero-slider]')),
    text: Boolean(document.querySelector('.home-hero .hero-title')),
  })), 'no covers falls back to text rather than standing empty').toEqual({ slider: false, text: true });
  await query`update posts set cover_media_id = (select id from media_items limit 1)`.execute(db);
  await writeThemeSettings('signin-test-owner', { id: 'paper', values: { hero: 'text' } });
  clearPageCache(owner);
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
  clearPageCache(owner);
  expect(await fetchesFeed(), 'on: the feed arrives').toBe(true);

  await writeThemeSettings('signin-test-owner', { id: 'paper', values: { infiniteScroll: 'off' } });
  clearPageCache(owner);
  // It was fetched in both states until the import became dynamic: the page's own script
  // carried the feed's code, so switching the setting off changed the markup and not the
  // bytes. This fails if a static import comes back.
  expect(await fetchesFeed(), 'off: and does not').toBe(false);
});

test('the reading progress bar is drawn from the scroll position', async ({ page }) => {
  test.setTimeout(120_000);
  const { writeThemeSettings } = await import('../../src/server/themes/store');
  const bar = page.locator('.reading-progress');
  const article = `${origin}/en/blog/post-0`;

  await writeThemeSettings('signin-test-owner', { id: 'paper', values: { readingProgress: 'off' } });
  clearPageCache(owner);
  await page.goto(article, { waitUntil: 'networkidle' });
  await expect(bar, 'a bar nobody asked for is not on the page').toHaveCount(0);

  await writeThemeSettings('signin-test-owner', { id: 'paper', values: { readingProgress: 'on' } });
  clearPageCache(owner);
  await page.goto(article, { waitUntil: 'networkidle' });
  await expect(bar).toHaveCount(1);

  // The bar is a transform, so the width of the box actually drawn is the only answer that
  // means anything: the markup is identical whether the animation runs or does nothing.
  const drawn = async () => (await bar.boundingBox())?.width ?? -1;
  const viewport = page.viewportSize()?.width ?? 0;
  expect(await drawn(), 'nothing read yet').toBeLessThan(viewport * 0.05);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(drawn, { message: 'the end of the article fills it' })
    .toBeGreaterThan(viewport * 0.9);

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(drawn, { message: 'and scrolling back up empties it again' })
    .toBeLessThan(viewport * 0.05);
});

test('the reading rail lists a post\'s headings at the side, and the bar takes its place where there is no room', async ({ page }) => {
  test.setTimeout(120_000);
  const { sql: query } = await import('kysely');
  const { db } = await import('../../src/server/db/client');
  const { writeThemeSettings } = await import('../../src/server/themes/store');
  const filler = '<p>Body line to read past.</p>'.repeat(40);
  await query`update posts set content_html = ${`<h2>First part</h2>${filler}<h3>Second, smaller</h3>${filler}<h2>Third part</h2>${filler}`} where slug = 'post-1'`.execute(db);
  await query`update posts set content_html = ${`<h2>Only heading</h2>${filler}`} where slug = 'post-2'`.execute(db);
  clearPageCache(owner);
  const article = `${origin}/en/blog/post-1`;
  const rail = page.locator('nav.reading-rail');
  const links = rail.getByRole('link');
  const displayed = (selector: string) => page.evaluate((target) => {
    const node = document.querySelector(target);
    return node ? getComputedStyle(node).display : 'absent';
  }, selector);

  await writeThemeSettings('signin-test-owner', { id: 'paper', values: { readingProgress: 'rail' } });
  clearPageCache(owner);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(article, { waitUntil: 'networkidle' });
  await expect(rail).toHaveAttribute('aria-label', 'On this page');
  await expect(links, 'a link for each heading').toHaveCount(3);
  await expect(links.nth(1)).toHaveAccessibleName('Second, smaller');
  expect(await displayed('.reading-progress'), 'the rail is drawn, so the bar gives way').toBe('none');

  const widths = await links.evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node, '::before').width));
  expect(widths, 'an h2 is a longer tick than an h3').toEqual(['24px', '16px', '24px']);

  const heading = page.locator('.post-body h3');
  await expect(heading, 'the anchor and the link agree').toHaveAttribute('id', 'second-smaller');
  await expect(links.nth(0), 'above the first heading, the first is the one marked').toHaveAttribute('aria-current', 'location');
  await links.nth(1).hover();
  const label = links.nth(1).locator('.reading-rail__label');
  await expect(label, 'hovering names the heading').toHaveCSS('opacity', '1');
  await expect(label).toHaveText('Second, smaller');
  await links.nth(1).click();
  await expect(heading).toBeInViewport();
  await expect(links.nth(1), 'and the reader is told where they are').toHaveAttribute('aria-current', 'location');
  await expect(links.nth(0)).not.toHaveAttribute('aria-current', 'location');
  await expect(page.locator('.reading-rail [aria-current]')).toHaveCount(1);

  // The tick of the heading being read stands out: longer, in the accent, and the ticks of the
  // headings already read are told apart from those still ahead.
  await expect(links.nth(0), 'read already').toHaveAttribute('data-passed', '');
  await expect(links.nth(1), 'the current one is not passed').not.toHaveAttribute('data-passed', '');
  await expect(links.nth(2), 'ahead').not.toHaveAttribute('data-passed', '');
  const tick = (index: number) => links.nth(index).evaluate((node) => {
    const style = getComputedStyle(node, '::before');
    const probe = document.createElement('i');
    document.body.append(probe);
    const colour = (name: string) => { probe.style.background = `var(${name})`; return getComputedStyle(probe).backgroundColor; };
    const answer = {
      transform: style.transform, background: style.backgroundColor, height: style.height,
      accent: colour('--color-accent'), ink: colour('--color-ink'), muted: colour('--color-muted'),
    };
    probe.remove();
    return answer;
  });
  await expect.poll(async () => (await tick(1)).transform, { message: 'an h3 grows from 1rem to 1.75rem' }).toBe('matrix(1.75, 0, 0, 1, 0, 0)');
  const [passed, current, ahead] = [await tick(0), await tick(1), await tick(2)];
  expect(current.background, 'the current tick is the accent').toBe(current.accent);
  expect(current.height, 'and thicker').toBe('3px');
  expect(passed.background, 'a heading already read is ink').toBe(passed.ink);
  expect(passed.transform, 'and does not grow').toBe('none');
  expect(ahead.background, 'a heading ahead is muted').toBe(ahead.muted);
  expect(ahead.height).toBe('2px');

  // No room: the rail is not drawn, and the bar is.
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(article, { waitUntil: 'networkidle' });
  await expect(rail).toBeHidden();
  expect(await displayed('.reading-progress'), 'a phone gets the bar').not.toBe('none');

  // A post with one heading has nothing to navigate: no rail, and the bar on every width.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/en/blog/post-2`, { waitUntil: 'networkidle' });
  await expect(rail).toHaveCount(0);
  expect(await displayed('.reading-progress')).not.toBe('none');
  await expect(page.locator('.post-body h2'), 'and no id nobody needed').not.toHaveAttribute('id', /./);

  // The bar is still the bar, and off is still nothing.
  await writeThemeSettings('signin-test-owner', { id: 'paper', values: { readingProgress: 'on' } });
  clearPageCache(owner);
  await page.goto(article, { waitUntil: 'networkidle' });
  await expect(rail).toHaveCount(0);
  expect(await displayed('.reading-progress'), 'the bar, at every width').not.toBe('none');
  await writeThemeSettings('signin-test-owner', { id: 'paper', values: { readingProgress: 'off' } });
  clearPageCache(owner);
  await page.goto(article, { waitUntil: 'networkidle' });
  await expect(rail).toHaveCount(0);
  await expect(page.locator('.reading-progress')).toHaveCount(0);
});

test('the rail marks the heading the reader is at, after an instant jump up, and the last at the end', async ({ page }) => {
  test.setTimeout(120_000);
  const { sql: query } = await import('kysely');
  const { db } = await import('../../src/server/db/client');
  const { writeThemeSettings } = await import('../../src/server/themes/store');
  const filler = '<p>Body line to read past.</p>'.repeat(40);
  // A short last section, which never reaches the line 40% down the window on its own, and an
  // empty heading the rail must not list.
  await query`update posts set content_html = ${`<h2>First part</h2>${filler}<h3>Second, smaller</h3>${filler}<h2></h2><h2>Third part</h2><p>Short end.</p>`} where slug = 'post-1'`.execute(db);
  await writeThemeSettings('signin-test-owner', { id: 'paper', values: { readingProgress: 'rail' } });
  clearPageCache(owner);
  // No smooth scrolling: every jump is instant, which is where the order of observer entries used to decide.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/en/blog/post-1`, { waitUntil: 'networkidle' });
  const links = page.locator('nav.reading-rail').getByRole('link');
  await expect(links, 'the empty heading has no link').toHaveCount(3);
  const current = async () => links.evaluateAll((nodes) => nodes.findIndex((node) => node.getAttribute('aria-current') === 'location'));

  await links.nth(1).click();
  await expect.poll(current, { message: 'read the h3' }).toBe(1);
  await links.nth(0).click();
  await expect.poll(current, { message: 'and a jump back up to the first lands on the first, not the one before the one it left' }).toBe(0);
  await links.nth(2).click();
  await expect.poll(current).toBe(2);
  await links.nth(0).click();
  await expect.poll(current, { message: 'from the last to the first' }).toBe(0);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(current, { message: 'the bottom of the page marks the last' }).toBe(2);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(current, { message: 'and the top marks the first' }).toBe(0);
});

test('the header can be asked to stay in view', async ({ page }) => {
  test.setTimeout(120_000);
  const { writeThemeSettings } = await import('../../src/server/themes/store');
  await page.setViewportSize({ width: 1280, height: 600 });

  /** Where the header is after the reader has gone down the page, which is the whole of it. */
  const afterScrolling = async () => {
    await page.evaluate(() => window.scrollTo(0, 500));
    return page.evaluate(() => new Promise<number>((resolve) => {
      requestAnimationFrame(() => {
        const box = document.querySelector('.site-header')?.getBoundingClientRect();
        resolve(box ? Math.round(box.top) : Number.NaN);
      });
    }));
  };

  await writeThemeSettings('signin-test-owner', { id: 'paper', values: { stickyHeader: 'off' } });
  clearPageCache(owner);
  await page.goto(`${origin}/en`, { waitUntil: 'networkidle' });
  expect(await afterScrolling(), 'a header nobody pinned scrolls away').toBeLessThan(0);

  await writeThemeSettings('signin-test-owner', { id: 'paper', values: { stickyHeader: 'on' } });
  clearPageCache(owner);
  await page.goto(`${origin}/en`, { waitUntil: 'networkidle' });
  expect(await afterScrolling(), 'and a pinned one stays at the top').toBe(0);

  // Nothing shows through it: a sticky header over the page it no longer scrolls with is
  // the one place the body's background stops being the header's.
  const painted = await page.evaluate(() => {
    const header = document.querySelector('.site-header') as HTMLElement;
    const box = header.getBoundingClientRect();
    const onTop = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {
      background: getComputedStyle(header).backgroundColor,
      ownsItsPixels: Boolean(onTop && (header === onTop || header.contains(onTop))),
    };
  });
  expect(painted.ownsItsPixels, 'the header is what is drawn where the header is').toBe(true);
  expect(painted.background, 'and it has a background of its own').not.toBe('rgba(0, 0, 0, 0)');
});

test('a post keeps its title the one h1 in Paper and in Plain, aligned headings in the body included', async ({ page }) => {
  const { sql: query } = await import('kysely');
  const { db } = await import('../../src/server/db/client');
  await query`update posts set content_html = ${'<h1 style="text-align: center">Centred part</h1><p>Text.</p><h1>Plain part</h1><p>More.</p>'} where slug = 'post-2'`.execute(db);
  clearPageCache(owner);
  const { rows: [before] } = await query<{ theme_id: string | null }>`select theme_id from site_settings`.execute(db);
  try {
    for (const theme of ['paper', 'plain']) {
      await query`update site_settings set theme_id = ${theme}`.execute(db);
      clearPageCache(owner);
      await page.goto(`${origin}/en/blog/post-2`, { waitUntil: 'networkidle' });
      await expect(page.locator('h1'), `${theme}: the title is the one h1`).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 2, name: 'Centred part' }), `${theme}: the aligned one is an h2`).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 2, name: 'Plain part' })).toHaveCount(1);
    }
  } finally {
    await query`update site_settings set theme_id = ${before?.theme_id ?? null}`.execute(db);
    clearPageCache(owner);
  }
});

test('a post\'s cover and its body picture are drawn from the copy that fits, in Paper, Plain and Almanac', async ({ page }) => {
  test.setTimeout(90_000);
  const { sql: query } = await import('kysely');
  const { db } = await import('../../src/server/db/client');
  const { ALMANAC_SIZES, PAPER_SIZES, PLAIN_SIZES } = await import('../../src/lib/responsive-image');
  const { rows: [{ id }] } = await query<{ id: string }>`select id from media_items limit 1`.execute(db);
  // The cover every post has is 1600 wide: its copies are the two narrower widths.
  await query`insert into media_variants (media_id, width, object_key, size_bytes)
    values (${id}::uuid, 480, 'seed/cover-480.webp', 10), (${id}::uuid, 960, 'seed/cover-960.webp', 10)`.execute(db);
  const content = { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Before the picture.' }] },
    { type: 'image', attrs: { alt: 'A loaf', mediaId: id, src: `/media/${id}` } },
  ] };
  await query`update posts set content_json = ${JSON.stringify(content)}::jsonb,
    content_html = ${`<p>Before the picture.</p><img src="/media/${id}" alt="A loaf" decoding="async" loading="lazy" />`}
    where slug = 'post-5'`.execute(db);
  const srcset = `/media/${id}?w=480 480w, /media/${id}?w=960 960w, /media/${id} 1600w`;
  const themes = [
    // Paper's cards are as many across as the theme is told, and a test above leaves it told something.
    { body: '.post-body img', card: '.post-card__cover img', cards: (across: string) => PAPER_SIZES.cards[across as '2' | '3' | '4'], cover: '.post-cover', sizes: PAPER_SIZES.article, theme: 'paper' },
    { body: '.plain-body img', card: null, cards: null, cover: '.plain-article > img', sizes: PLAIN_SIZES.article, theme: 'plain' },
    { body: '.almanac-prose img', card: '.almanac-card__panel img', cards: () => ALMANAC_SIZES.card, cover: '.almanac-article__cover', sizes: ALMANAC_SIZES.article, theme: 'almanac' },
  ];
  const { rows: [before] } = await query<{ theme_id: string | null }>`select theme_id from site_settings`.execute(db);
  try {
    for (const { body, card, cards, cover, sizes, theme } of themes) {
      await query`update site_settings set theme_id = ${theme}`.execute(db);
      clearPageCache(owner);
      await page.goto(`${origin}/en/blog/post-5`, { waitUntil: 'networkidle' });
      for (const [what, picture] of [['cover', page.locator(cover)], ['body picture', page.locator(body)]] as const) {
        await expect(picture, `${theme}: one ${what}`).toHaveCount(1);
        await expect(picture, `${theme}: the ${what} offers its copies and its original`).toHaveAttribute('srcset', srcset);
        await expect(picture, `${theme}: as wide as the column it is drawn in`).toHaveAttribute('sizes', sizes);
        await expect(picture, `${theme}: with the ${what}'s own size`).toHaveAttribute('width', '1600');
        await expect(picture).toHaveAttribute('height', '900');
      }
      await expect(page.locator(cover), `${theme}: the cover is still the first paint`).toHaveAttribute('fetchpriority', 'high');
      await expect(page.locator(body), `${theme}: the body picture keeps its words and waits its turn`).toHaveAttribute('alt', 'A loaf');
      await expect(page.locator(body)).toHaveAttribute('loading', 'lazy');
      if (!card || !cards) continue;
      await page.goto(`${origin}/en`, { waitUntil: 'networkidle' });
      await expect(page.locator(card).first(), `${theme}: a card's cover is drawn from its copies too`).toHaveAttribute('srcset', srcset);
      const across = theme === 'paper'
        ? await page.locator('[data-post-grid]').evaluate((grid: HTMLElement) => grid.style.getPropertyValue('--post-grid-columns').trim())
        : '';
      await expect(page.locator(card).first(), `${theme}: as wide as a card is drawn`).toHaveAttribute('sizes', cards(across));
    }
  } finally {
    await query`update site_settings set theme_id = ${before?.theme_id ?? null}`.execute(db);
    await query`delete from media_variants where media_id = ${id}::uuid`.execute(db);
    clearPageCache(owner);
  }
});
