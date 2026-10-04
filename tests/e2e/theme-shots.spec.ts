import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

import type { Page } from '@playwright/test';

import { contentSlug } from '../../src/lib/slug';
import type { EditorDocument, EditorNode } from '../../src/types/cms';
import { expect, test } from './own-worker';

/**
 * Shoots the three public themes -- Paper, Plain and Almanac -- and measures the few boxes a design
 * release makes claims about. Run by hand around a layer:
 *
 *   THEME_SHOTS=before npm run test:e2e -- tests/e2e/theme-shots.spec.ts --project=desktop
 *
 * Writes to .superpowers/theme-shots/<label>/<theme>/<screen>-<width>-<scheme>.png (git-ignored),
 * and a measure.json beside them. Playwright empties test-results/ at the start of every run, so
 * nothing written there would survive the next one.
 *
 * Without THEME_SHOTS it skips, so the suite never pays for it. The site is written through the
 * functions the admin uses, so nobody has to sign in: this file spends no /recovery sign-in.
 */

test.use({ stack: 'theme-shots', reducedMotion: 'reduce' });
test.skip(!process.env.THEME_SHOTS, 'Set THEME_SHOTS=<label> to write screenshots.');
test.skip(({ isMobile }) => Boolean(isMobile), 'Widths are set by hand below.');

// Unset, the file is skipped above, but it is still loaded: join() must not see undefined.
const LABEL = process.env.THEME_SHOTS ?? 'unset';
const OUT = join('.superpowers', 'theme-shots', LABEL);
const PROJECT = 'tomecms-theme-shots';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'theme-shots-secret-at-least-32-chars';
const OWNER = 'theme-shots-owner';
const THEMES = ['paper', 'plain', 'almanac'] as const;
// 1024 is where Paper's slide words go over the picture (64rem).
const WIDTHS = [320, 375, 768, 1024, 1440] as const;
const SCHEMES = ['light', 'dark'] as const;
const THAI_SLUG = 'ขนมปัง-ยามค่ำ';
const THAI_CATEGORY = 'สูตรขนม';
/** Long enough to wrap to two lines at 375 px in a title face. */
const THAI_TITLE = 'ขนมปังยามค่ำ กลิ่นหอมจากเตาอบเก่าแก่ของร้านเรา';
const EMPTY_CATEGORY = 'Empty Shelf';
const POST = '/en/blog/all-the-blocks';
const COVER_POST = '/en/blog/why-we-bake-at-night';
const LONG_COVER_TITLE = 'A title that is long enough to need two lines on a phone';

const SCREENS: ReadonlyArray<readonly [name: string, path: string]> = [
  ['home', '/en'],
  ['post', POST],
  ['post-cover', COVER_POST],
  ['page', '/en/about'],
  ['category', '/en?category=Recipes'],
  ['category-empty', `/en?category=${encodeURIComponent(EMPTY_CATEGORY)}`],
  ['search', '/en?q=bread'],
  ['404', '/en/no-such-page'],
  // The Thai site: its home, whose category names and titles are Thai, and the post with a Thai slug.
  ['home-th', '/th'],
  ['post-th', `/th/blog/${encodeURIComponent(THAI_SLUG)}`],
];

// Paper's covers slider, which the "slides" setting the seed leaves on would hide.
const PAPER_ONLY: ReadonlyArray<readonly [name: string, path: string]> = [['home-covers', '/en']];

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

const text = (value: string): EditorNode => ({ type: 'text', text: value });
const paragraph = (value: string): EditorNode => ({ type: 'paragraph', content: [text(value)] });
const heading = (level: number, value: string): EditorNode => ({ type: 'heading', attrs: { level }, content: [text(value)] });
const items = (type: 'bulletList' | 'orderedList', ...labels: string[]): EditorNode => ({
  type, content: labels.map((label) => ({ type: 'listItem', content: [paragraph(label)] })),
});
const body = (...blocks: EditorNode[]): EditorDocument => ({ type: 'doc', content: blocks });
const LONG = 'The oven is already warm by the time the street goes quiet, and the dough has had all afternoon to make up its mind about what it wants to be. ';

let server: ChildProcess | undefined;
let origin = '';

/** The site every shot reads, written through the functions the admin uses. */
async function seed(imageId: string, fileId: string) {
  const { createCategory } = await import('../../src/server/content/categories');
  const [fieldNotes, recipes, thai] = await Promise.all(['Field Notes', 'Recipes', THAI_CATEGORY].map((name) => createCategory(OWNER, name)));
  await createCategory(OWNER, EMPTY_CATEGORY);
  const { sql } = await import('kysely');
  const { db } = await import('../../src/server/db/client');

  const everyBlock = body(
    paragraph(`${LONG}${LONG}`),
    heading(2, 'The first hour'),
    paragraph('Flour, water and patience. The rest is waiting, and a little salt.'),
    heading(3, 'What goes in the bowl'),
    items('bulletList', 'Four hundred grams of strong flour', 'Three hundred grams of water', 'A pinch of salt, and no hurry'),
    items('orderedList', 'Mix until no dry flour is left', 'Rest for thirty minutes', 'Fold, then rest again'),
    { type: 'blockquote', content: [paragraph('The best bread is the one that was not rushed.')] },
    { type: 'paragraph', content: [text('Set the oven to '), { type: 'text', text: '240 C', marks: [{ type: 'code' }] }, text(' and wait for it to settle.')] },
    { type: 'codeBlock', attrs: { language: 'javascript' }, content: [text('const dough = flour + water;\nconst loaf = bake(dough, { minutes: 35 });')] },
    { type: 'image', attrs: { src: `/media/${imageId}`, alt: 'A loaf on a board', mediaId: imageId } },
    { type: 'attachment', attrs: { mediaId: fileId } },
    paragraph('Last, a plain paragraph so the page does not end on a figure.'),
  );
  // Newest first. The first has every kind of block and no cover; the second, third and fourth have covers, and the
  // fourth's title is the long one Paper's covers slider has to keep clear of its buttons.
  const posts: Array<{ slug: string; title: string; categories: string[]; cover: boolean; excerpt: string; content: EditorDocument }> = [
    { slug: 'all-the-blocks', title: 'A loaf, a bowl and every block there is', categories: [recipes.id], cover: false,
      excerpt: 'Headings, lists, a quotation, code, a picture and a file, in one post.', content: everyBlock },
    { slug: 'why-we-bake-at-night', title: 'Why we bake at night', categories: [fieldNotes.id], cover: true,
      excerpt: 'The dough is calmer after dark, and so is the baker.', content: body(paragraph(`${LONG}${LONG}`), heading(2, 'The first hour'), paragraph('Flour, water and patience.')) },
    { slug: 'evening-bread', title: 'Evening bread', categories: [thai.id], cover: true,
      excerpt: 'A loaf for the end of the day.', content: body(paragraph('A short note about a loaf, written in the evening.')) },
    { slug: 'a-title-that-needs-two-lines-to-say-everything', title: 'A title that is long enough to need two lines on a phone, bread included', categories: [fieldNotes.id], cover: true,
      excerpt: 'Long titles are where a theme shows its edges.', content: body(paragraph('The title is the point of this post.')) },
    { slug: 'butter-and-patience', title: 'Butter and patience', categories: [], cover: false,
      excerpt: 'A post filed under the default category.', content: body(paragraph('Butter keeps; patience does not.')) },
    ...['first', 'second', 'third', 'fourth', 'fifth'].map((ordinal, index) => ({
      slug: `recipe-${index + 1}`, title: `Notes on the ${ordinal} recipe`, categories: [index % 2 ? recipes.id : thai.id], cover: index === 0,
      excerpt: `Recipe number ${index + 1}, written down while the bread was still warm.`, content: body(paragraph(`A short note about recipe ${index + 1}, and about bread.`)),
    })),
  ];
  expect(posts.length, 'ten published posts').toBe(10);
  const { createPost } = await import('../../src/server/content/posts');
  const made: Array<{ id: string; slug: string; categories: string[]; cover: boolean }> = [];
  for (const [index, post] of posts.entries()) {
    const created = await createPost(OWNER, {
      title: post.title, slug: post.slug, excerpt: post.excerpt, contentJson: post.content, categoryIds: post.categories,
      coverMediaId: post.cover ? imageId : null, metaTitle: null, metaDescription: null, status: 'published',
      publishedAt: new Date(Date.now() - (index + 1) * 86_400_000).toISOString(),
    });
    made.push({ id: created.id, slug: post.slug, categories: post.categories, cover: post.cover });
  }
  // Thai editions of five of them: one with a Thai slug and a title of two lines, and the rest short.
  const thaiEditions: Array<[source: string, slug: string, title: string, excerpt: string]> = [
    ['evening-bread', contentSlug(THAI_SLUG), THAI_TITLE, 'ขนมปังก้อนหนึ่งสำหรับปลายวัน อบช้า ๆ และกินตอนยังอุ่น'],
    ['why-we-bake-at-night', 'อบตอนกลางคืน', 'ทำไมเราจึงอบขนมปังตอนกลางคืน', 'แป้งนิ่งขึ้นหลังมืดค่ำ คนอบก็เช่นกัน'],
    ['recipe-1', 'สูตร-หนึ่ง', 'บันทึกสูตรแรก', 'สูตรที่หนึ่ง จดไว้ตอนขนมปังยังอุ่น'],
    ['recipe-2', 'สูตร-สอง', 'บันทึกสูตรที่สอง', 'สูตรที่สอง จดไว้ตอนขนมปังยังอุ่น'],
    ['butter-and-patience', 'เนย-และ-ความอดทน', 'เนยและความอดทน', 'เนยเก็บได้ แต่ความอดทนเก็บไม่ได้'],
  ];
  for (const [source, slug, title, excerpt] of thaiEditions) {
    const original = made.find((post) => post.slug === source)!;
    await createPost(OWNER, {
      title, slug, excerpt, contentJson: body(paragraph('เริ่มจากแป้งสองถ้วย น้ำหนึ่งถ้วย และเวลาอีกสักหน่อย ปล่อยให้แป้งพักจนฟู แล้วจึงนำเข้าเตา'), heading(2, 'ชั่วโมงแรก'), paragraph('แป้ง น้ำ และความอดทน ที่เหลือคือการรอคอย')),
      categoryIds: original.categories, coverMediaId: original.cover ? imageId : null, metaTitle: null, metaDescription: null,
      status: 'published', publishedAt: new Date(Date.now() - 86_400_000).toISOString(), locale: 'th', sourcePostId: original.id,
    });
  }
  // The service splits a Thai slug at ICU's word boundaries (ขนมปัง-ยาม-ค่ำ), and the audit's address is
  // the one a person types by hand, so this one is written as it was typed.
  await sql`update posts set slug = ${THAI_SLUG} where locale = 'th' and slug = ${contentSlug(THAI_SLUG)}`.execute(db);

  const { createPage } = await import('../../src/server/content/pages');
  const makePage = async (title: string, slug: string, blocks: EditorNode[]) => (await createPage(OWNER, {
    excerpt: '', title, slug, metaTitle: null, metaDescription: null, status: 'published', contentJson: body(...blocks),
  })).id;
  const about = await makePage('About the bakery', 'about', [
    paragraph('A bakery on a quiet street, writing in two languages.'), heading(2, 'Who we are'),
    paragraph(`${LONG}${LONG}`), items('bulletList', 'Open at dawn', 'Closed on Mondays'),
  ]);
  const team = await makePage('Team', 'team', [paragraph('Three bakers.')]);
  const link = (label: string, url: string) => ({ kind: 'custom' as const, label, pageId: null, url, newTab: false });
  const { replaceNavigation } = await import('../../src/server/content/navigation');
  await replaceNavigation(OWNER, { locale: 'en', location: 'header', items: [
    { kind: 'home', label: 'Home', pageId: null, url: null, newTab: false },
    { kind: 'page', label: 'About', pageId: about, url: null, newTab: false, children: [
      { kind: 'page', label: 'Team', pageId: team, url: null, newTab: false },
      link('Contact', '/contact'),
    ] },
    link('Shop', '/shop'),
  ] });
  await replaceNavigation(OWNER, { locale: 'en', location: 'footer', items: [link('Privacy', '/privacy'), link('Feed', '/feed')] });
  await replaceNavigation(OWNER, { locale: 'th', location: 'header', items: [
    { kind: 'home', label: 'หน้าแรก', pageId: null, url: null, newTab: false },
    { ...link('เกี่ยวกับเรา', '/th/about'), children: [link('ทีมของเรา', '/th/team'), link('ติดต่อ', '/th/contact')] },
    link('ร้านค้า', '/th/shop'),
  ] });
  await replaceNavigation(OWNER, { locale: 'th', location: 'footer', items: [link('นโยบายความเป็นส่วนตัว', '/th/privacy'), link('ฟีด', '/feed')] });

  // Paper's slides, one set a language, with words on both.
  const { homeSlidesSchema } = await import('../../src/lib/home-slides');
  const { replaceSlides } = await import('../../src/server/content/slides');
  const slide = (heading: string, words: string, label: string) => ({
    mediaId: imageId, heading, body: words, align: 'start', overlay: 'soft',
    button: { label, link: { kind: 'custom', url: '/en/blog/why-we-bake-at-night', newTab: false } },
  });
  await replaceSlides(OWNER, homeSlidesSchema.parse({ locale: 'en', slides: [
    slide('Bread, written down', 'Notes from a small bakery, set down while the oven cools.', 'Read the notes'),
    slide('Why we bake at night', 'The dough is calmer after dark, and so is the baker.', 'Start reading'),
  ] }));
  await replaceSlides(OWNER, homeSlidesSchema.parse({ locale: 'th', slides: [
    slide('ขนมปัง จดไว้ในสมุด', 'บันทึกจากร้านเบเกอรี่เล็ก ๆ เขียนไว้ระหว่างรอเตาอบเย็นลง', 'อ่านบันทึก'),
    slide('ทำไมเราจึงอบตอนกลางคืน', 'แป้งนิ่งขึ้นหลังมืดค่ำ คนอบก็เช่นกัน', 'เริ่มอ่าน'),
  ] }));
  const { writeThemeSettings } = await import('../../src/server/themes/store');
  await writeThemeSettings(OWNER, { id: 'paper', values: { hero: 'slides' } });
}

test.beforeAll(async () => {
  // Migrating, seeding and a cold dev server are more than the 30 s a hook gets.
  test.setTimeout(240_000);
  const port = await freePort();
  origin = `http://localhost:${port}`;
  const env: NodeJS.ProcessEnv = {
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
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-theme-shots',
  };
  docker(['up', '-d', '--wait', '--wait-timeout', '90', 'postgres', 'seaweedfs']);
  docker(['exec', '-T', 'postgres', 'psql', '--quiet', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1',
    '-U', 'tomecms_test', '-d', 'tomecms_test', '-c', 'drop schema public cascade; create schema public;'], 60_000);
  Object.assign(process.env, env);
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  await migrateToLatest();
  const { sql } = await import('kysely');
  const { db } = await import('../../src/server/db/client');
  await sql`insert into "user" (id, name, email, "emailVerified", role, "createdAt", "updatedAt")
    values (${OWNER}, 'Owner', 'owner@tomecms.invalid', true, 'owner', now(), now())`.execute(db);
  await sql`insert into site_settings (id, owner_id, site_name, default_locale, timezone, admin_path, tagline)
    values (true, ${OWNER}, 'Quiet Notes', 'en', 'Asia/Bangkok', '/admin', 'Notes from a small bakery')`.execute(db);
  await sql`insert into categories (owner_id, name, is_default) values (${OWNER}, 'Uncategorized', true)`.execute(db);
  // Two library rows, with no object behind either: the browser is handed a picture for the first
  // below, and nothing here follows the second.
  const [image, file] = (await sql<{ id: string }>`insert into media_items (owner_id, folder_id, object_key, original_name, mime_type,
      size_bytes, width, height, checksum_sha256, alt_text, state)
    values (${OWNER}, null, 'seed/cover.webp', 'cover.webp', 'image/webp', 1000, 1600, 900, ${`${'a'.repeat(43)}=`}, 'A loaf on a board', 'ready'),
      (${OWNER}, null, 'seed/baking-guide.pdf', 'baking-guide.pdf', 'application/pdf', 482000, null, null, ${`${'b'.repeat(43)}=`}, null, 'ready')
    returning id`.execute(db)).rows;
  await seed(image.id, file.id);

  server = spawn(process.execPath, ['./node_modules/astro/bin/astro.mjs', 'dev', '--ignore-lock',
    '--host', 'localhost', '--port', String(port)], { cwd: process.cwd(), env, stdio: 'pipe' });
  let output = '';
  server.stdout?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  server.stderr?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Shots server exited early.\n${output}`);
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) return;
    } catch {
      // Astro is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Shots server never became ready.\n${output}`);
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

// The covers are not in the object store; the media route would answer 404 for each of them.
test.beforeEach(async ({ page }) => {
  await page.route('**/media/**', (route) => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#8a9b7a"/></svg>',
  }));
});

/** The boxes a design release names, read from whichever of the three themes is showing. */
async function measureOf(page: Page) {
  return page.evaluate(() => {
    const find = (selector: string) => document.querySelector<HTMLElement>(selector);
    const box = (element: HTMLElement | null) => {
      if (!element) return null;
      const { top, left, width, height } = element.getBoundingClientRect();
      return { top: Math.round(top), left: Math.round(left), width: Math.round(width), height: Math.round(height) };
    };
    // How many characters of the paragraph's own face fit across it, by the width of a "0" there.
    const characters = (element: HTMLElement | null) => {
      if (!element) return null;
      const probe = document.createElement('span');
      probe.textContent = '0'.repeat(20);
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;';
      element.append(probe);
      const zero = probe.getBoundingClientRect().width / 20;
      probe.remove();
      return Math.round(element.getBoundingClientRect().width / zero);
    };
    const title = find('.article-title, .plain-article h1, .almanac-article__title');
    const prose = find('.post-body p, .plain-body p, .almanac-prose p');
    return {
      brand: box(find('.site-wordmark, .plain-wordmark, .almanac-brand')),
      firstCard: box(find('.post-card, .plain-lead, .almanac-card')),
      title: box(title),
      titleFont: title ? getComputedStyle(title).font : null,
      prose: box(prose),
      proseCharacters: characters(prose),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
}

/** One screen at every width and scheme: a shot of each, and the measures of the light one. */
async function shoot(page: Page, theme: string, name: string, path: string, measured: Record<string, unknown>, only?: { element: string; ready: (page: Page) => Promise<void> }) {
  for (const width of WIDTHS) {
    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.setViewportSize({ width, height: width > 400 ? 900 : 844 });
      const response = await page.goto(`${origin}${path}`);
      // A screen that is not what its name says (a post that 404s) is a broken seed, not a shot.
      expect(response?.status(), `${theme} ${name} ${width} ${scheme}`).toBe(name === '404' ? 404 : 200);
      // A concrete element first (Plain's empty category has no heading), then quiet: the dev server can re-optimise and reload a page
      // after it loads, and a shot taken in that gap is of a page about to be replaced.
      await expect(page.locator('main').first()).toBeAttached({ timeout: 30_000 });
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => document.fonts.ready);
      await only?.ready(page);
      await page.waitForTimeout(300);
      // A full-page shot resizes the viewport, and the track's snap puts a scrolled slider back on its first slide.
      const file = join(OUT, theme, `${name}-${width}-${scheme}.png`);
      await (only ? page.locator(only.element).screenshot({ path: file }) : page.screenshot({ path: file, fullPage: true }));
      if (scheme === 'light') measured[`${name}-${width}`] = await measureOf(page);
    }
  }
}

/** Brings the covers slider to the slide whose title is the long one, which is not the first. Reduced motion keeps the rotation from moving it. */
async function showLongCover(page: Page) {
  await page.locator('.hero-slider').evaluate(async (track, longTitle) => {
    const index = [...track.children].findIndex((slide) => slide.textContent?.includes(longTitle));
    if (index < 0) throw new Error('The long cover is not in the slider.');
    const left = index * track.clientWidth;
    track.scrollTo({ left });
    // Resolves once the snap has landed, never on a fixed wait.
    while (Math.abs(track.scrollLeft - left) > 1) await new Promise((resolve) => requestAnimationFrame(resolve));
  }, LONG_COVER_TITLE);
}

test('the three themes, every screen, five widths, both schemes', async ({ page }) => {
  test.setTimeout(1_800_000);
  const { sql } = await import('kysely');
  const { db } = await import('../../src/server/db/client');
  const measure: Record<string, Record<string, unknown>> = {};
  for (const theme of THEMES) {
    mkdirSync(join(OUT, theme), { recursive: true });
    await sql`update site_settings set theme_id = ${theme}`.execute(db);
    measure[theme] = {};
    for (const [name, path] of SCREENS) await shoot(page, theme, name, path, measure[theme]);
    if (theme === 'paper') {
      // The covers slider is a setting of Paper's, and the seed leaves "your slides" on.
      const { writeThemeSettings } = await import('../../src/server/themes/store');
      await writeThemeSettings(OWNER, { id: 'paper', values: { hero: 'slider' } });
      for (const [name, path] of PAPER_ONLY) await shoot(page, theme, name, path, measure[theme], { element: '.home-hero--slider', ready: showLongCover });
      await writeThemeSettings(OWNER, { id: 'paper', values: { hero: 'slides' } });
    }
  }
  writeFileSync(join(OUT, 'measure.json'), JSON.stringify(measure, null, 2));
  expect(Object.keys(measure).length).toBe(THEMES.length);
});
