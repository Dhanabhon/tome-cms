/**
 * Photographs the admin for the documentation, in English and in Thai.
 *
 * It builds a small, believable site on a disposable stack: posts and pages in both languages,
 * pictures, a menu, a slide and some counts. It signs in with a virtual passkey and saves one
 * picture per screen. Run it from the repository root when a screen changes:
 * `npm run docs:screenshots`, or `npm run docs:screenshots -- system` for only the screens named.
 * It uses ports 55432 and 59000, like the e2e specs, so never run the two at once.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';

import sharp from 'sharp';

import { chromium, type BrowserContext, type Page } from 'playwright';

const COMPOSE = ['compose', '-p', 'tomecms-docs-shots', '-f', 'compose.test.yaml'];
const CREDENTIAL = 'docs-screenshots-secret-at-least-32ch';
const OWNER = '2b7e1f3a-9c4d-4e5f-8a6b-7c8d9e0f1a2b';
const OUT = new URL('../src/assets/screenshots/', import.meta.url);
/** Kept under this in bytes, per the task brief; a bigger file is re-encoded with a palette. */
const MAX_BYTES = 400_000;

/**
 * The screens, by file name and path under the admin. `edit` is filled in once a post exists.
 *
 * `posts` and `pages` ask for every status: both list screens default to `status=draft` when
 * the query string is silent (src/pages/admin/index.astro, src/pages/admin/pages/index.astro),
 * which would otherwise hide every published and scheduled story the seed below writes.
 */
const SCREENS: Array<{ name: string; path: string }> = [
  { name: 'posts', path: '/admin?status=all' },
  { name: 'editor', path: '/admin/edit/:post' },
  { name: 'pages', path: '/admin/pages?status=all' },
  { name: 'navigation', path: '/admin/navigation' },
  { name: 'slides', path: '/admin/slides' },
  { name: 'media', path: '/admin/media' },
  { name: 'redirects', path: '/admin/redirects' },
  { name: 'stats', path: '/admin/stats' },
  { name: 'settings', path: '/admin/settings' },
  { name: 'maintenance', path: '/admin/maintenance' },
  { name: 'profile', path: '/admin/profile' },
  { name: 'security', path: '/admin/security' },
  { name: 'themes', path: '/admin/themes' },
  { name: 'plugins', path: '/admin/plugins' },
  { name: 'system', path: '/admin/system' },
];

/** The screens named on the command line, or every one when none is. */
const wanted = process.argv.slice(2);
const unknown = wanted.filter((name) => !SCREENS.some((screen) => screen.name === name));
if (unknown.length) throw new Error(`No such screen: ${unknown.join(', ')}`);
const shots = wanted.length ? SCREENS.filter(({ name }) => wanted.includes(name)) : SCREENS;

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
      server.close(() => resolve(address.port));
    });
  });
}

const port = await freePort();
const origin = `http://localhost:${port}`;
const env = {
  ...process.env,
  NODE_ENV: 'development',
  ASTRO_DEV_BACKGROUND: '1',
  DATABASE_URL: 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
  TOME_CMS_PUBLIC_URL: origin,
  TOME_CMS_TEST_ORIGIN: origin,
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
  TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-docs-shots',
};
Object.assign(process.env, env);

let server: ChildProcess | undefined;
try {
  docker(['up', '-d', '--wait', '--wait-timeout', '90', 'postgres', 'seaweedfs']);
  docker(['exec', '-T', 'postgres', 'psql', '--quiet', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1',
    '-U', 'tomecms_test', '-d', 'tomecms_test', '-c', 'drop schema public cascade; create schema public;'], 60_000);

  const { migrateToLatest } = await import('../../src/server/db/migrator');
  await migrateToLatest();
  const postId = await seed();

  server = spawn(process.execPath, ['./node_modules/astro/bin/astro.mjs', 'dev', '--ignore-lock',
    '--host', 'localhost', '--port', String(port)], { cwd: process.cwd(), env, stdio: 'ignore' });
  for (let attempt = 0; ; attempt += 1) {
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) break;
    } catch {
      // Astro is still starting.
    }
    if (attempt > 120) throw new Error('The dev server never became ready.');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ colorScheme: 'light', viewport: { height: 800, width: 1280 } });
    const page = await context.newPage();
    await signIn(context, page);
    const { sql } = await import('kysely');
    const { db } = await import('../../src/server/db/client');
    for (const locale of ['en', 'th'] as const) {
      // The admin speaks the site's default language.
      await sql`update site_settings set default_locale = ${locale}`.execute(db);
      mkdirSync(new URL(`${locale}/`, OUT), { recursive: true });
      for (const { name, path } of shots) {
        await page.goto(`${origin}${path.replace(':post', postId)}`);
        await page.waitForLoadState('networkidle');
        await page.evaluate(() => document.fonts.ready);
        await shoot(page, new URL(`${locale}/${name}.png`, OUT));
        console.log(`${locale}/${name}.png`);
      }
    }
  } finally {
    await browser.close();
  }
} finally {
  server?.kill('SIGTERM');
  try {
    const { closeDatabase } = await import('../../src/server/db/client');
    await closeDatabase();
  } catch {
    // The pool may never have opened.
  }
  docker(['down', '--volumes', '--remove-orphans'], 90_000);
}

/** A full-page capture, re-encoded with a palette only when the direct capture is too big. */
async function shoot(page: Page, target: URL) {
  // A sticky save bar sticks to wherever it sat at scroll position zero, not to the true
  // bottom of the page, once the capture is taller than the viewport: static positioning
  // renders it once, in its own place in the flow, the way a single flat picture needs it to.
  await page.addStyleTag({ content: '.admin-save-bar, .home-slides-actions { position: static !important; }' });
  const image = await page.screenshot({ fullPage: true });
  const final = image.byteLength > MAX_BYTES ? await sharp(image).png({ palette: true }).toBuffer() : image;
  await writeFile(target, final);
}

async function signIn(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  const { issueRecoveryEnrollment } = await import('../../src/server/auth/recovery');
  const enrollment = await issueRecoveryEnrollment(OWNER);
  await page.goto(`${origin}/recovery?context=${encodeURIComponent(enrollment.context)}`);
  await page.getByRole('button', { name: /Create recovery Passkey/i }).click();
  await page.waitForURL(`${origin}/admin`, { timeout: 30_000 });
}

/** A small site worth looking at. Returns an English post's id, for the editor's picture. */
async function seed(): Promise<string> {
  const { sql } = await import('kysely');
  const { db } = await import('../../src/server/db/client');
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const { s3, s3Bucket } = await import('../../src/server/media/storage');
  const { createObjectKey } = await import('../../src/server/media/keys');

  await sql`insert into "user" (id, name, email, "emailVerified", role, "createdAt", "updatedAt")
    values (${OWNER}, 'Somchai Writer', 'owner@tomecms.invalid', true, 'owner', now(), now())`.execute(db);
  await sql`insert into site_settings (id, owner_id, site_name, default_locale, timezone, admin_path)
    values (true, ${OWNER}, 'Quiet Notes', 'en', 'Asia/Bangkok', '/admin')`.execute(db);
  const category = await db.insertInto('categories').values({ owner_id: OWNER, name: 'Uncategorized', is_default: true })
    .returning('id').executeTakeFirstOrThrow();

  // Pictures drawn here, so the documentation ships nothing it has no rights to.
  const picture = async (hue: number, name: string) => {
    const width = 1600;
    const height = 900;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 45% 62%)"/><stop offset="1" stop-color="hsl(${hue + 40} 35% 30%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
    const body = await sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
    const key = createObjectKey(OWNER, 'image/jpeg');
    await s3.send(new PutObjectCommand({ Body: body, Bucket: s3Bucket, ContentType: 'image/jpeg', Key: key }));
    return (await db.insertInto('media_items').values({
      alt_text: name, checksum_sha256: `${'A'.repeat(43)}=`, delete_error_code: null, folder_id: null, height,
      mime_type: 'image/jpeg', object_key: key, original_name: `${name}.jpg`, owner_id: OWNER, size_bytes: body.length,
      state: 'ready', width,
    } as never).returning('id').executeTakeFirstOrThrow()).id;
  };
  const pictures = [await picture(150, 'Morning light'), await picture(30, 'Paper and ink'), await picture(210, 'A quiet street')];

  const html = (text: string) => `<p>${text}</p>`;
  const post = (locale: 'en' | 'th', title: string, text: string, cover: string, status: 'draft' | 'published', publishedAt: Date | null) =>
    db.transaction().execute(async (trx) => {
      const group = await trx.insertInto('post_translation_groups').values({ owner_id: OWNER }).returning('id').executeTakeFirstOrThrow();
      const { id } = await trx.insertInto('posts').values({
        content_html: html(text), content_json: { content: [{ content: [{ text, type: 'text' }], type: 'paragraph' }], type: 'doc' },
        cover_media_id: cover, locale, meta_description: null, meta_title: null, owner_id: OWNER, published_at: publishedAt,
        slug: `${locale}-${randomUUID().slice(0, 8)}`, status, title, translation_group_id: group.id,
      }).returning('id').executeTakeFirstOrThrow();
      await trx.insertInto('post_category_assignments').values({ category_id: category.id, owner_id: OWNER, translation_group_id: group.id }).execute();
      return id;
    });
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000);
  const first = await post('en', 'Notes from a quiet workshop', 'What a small studio learned about writing in two languages.', pictures[0], 'published', day(-6));

  // A fuller body for the post the editor screenshot opens, so the screen shows a real
  // article instead of one short paragraph over a lot of empty space.
  const paragraph = (text: string) => ({ content: [{ text, type: 'text' }], type: 'paragraph' });
  const heading = (level: number, text: string) => ({ attrs: { level }, content: [{ text, type: 'text' }], type: 'heading' });
  const bulletList = (items: string[]) => ({ content: items.map((text) => ({ content: [paragraph(text)], type: 'listItem' })), type: 'bulletList' });
  const image = (mediaId: string, alt: string) => ({ attrs: { alt, mediaId, src: `/media/${mediaId}` }, type: 'image' });
  const paragraphs = [
    'What a small studio learned about writing in two languages.',
    'Most weeks start in English and move to Thai by Thursday. Nothing is translated word for word; each edition is written on its own, from the same short notes.',
    'The workshop is small on purpose. Six posts in, and the desk still fits in one corner of the room.',
  ];
  const items = [
    'Write the shorter language first. English drafts fast, and Thai follows once the shape is settled.',
    'Read every paragraph aloud before it is marked published.',
    'Keep one photograph a post, and let it say what the words do not need to.',
  ];
  await db.updateTable('posts').set({
    content_html: [
      `<p>${paragraphs[0]}</p>`, '<h2>Two languages, one desk</h2>', `<p>${paragraphs[1]}</p>`,
      `<ul>${items.map((text) => `<li><p>${text}</p></li>`).join('')}</ul>`,
      `<img src="/media/${pictures[1]}" alt="Paper and ink" class="rounded-lg">`, `<p>${paragraphs[2]}</p>`,
    ].join(''),
    content_json: {
      content: [paragraph(paragraphs[0]), heading(2, 'Two languages, one desk'), paragraph(paragraphs[1]),
        bulletList(items), image(pictures[1], 'Paper and ink'), paragraph(paragraphs[2])],
      type: 'doc',
    },
  } as never).where('id', '=', first).execute();

  await post('en', 'Keeping a site small', 'Fewer pages, read more often.', pictures[1], 'published', day(-3));
  await post('en', 'Draft: the next chapter', 'Still being written.', pictures[2], 'draft', null);
  await post('th', 'บันทึกจากโต๊ะทำงาน', 'สิ่งที่ได้เรียนรู้จากการเขียนสองภาษา', pictures[0], 'published', day(-5));
  await post('th', 'เว็บเล็ก ๆ ที่มีคนอ่าน', 'หน้าน้อยลง แต่ถูกอ่านบ่อยขึ้น', pictures[1], 'published', day(-2));
  await post('th', 'ตอนต่อไป (ร่าง)', 'ยังเขียนไม่เสร็จ', pictures[2], 'published', day(3));

  for (const [locale, title] of [['en', 'About'], ['th', 'เกี่ยวกับเรา']] as const) {
    const group = await db.insertInto('page_translation_groups').values({ owner_id: OWNER }).returning('id').executeTakeFirstOrThrow();
    const page = await db.insertInto('pages').values({
      content_html: html(title), content_json: { content: [], type: 'doc' }, locale, meta_description: null, meta_title: null,
      owner_id: OWNER, published_at: day(-10), slug: locale === 'en' ? 'about' : 'เกี่ยวกับเรา', status: 'published', title,
      translation_group_id: group.id,
    }).returning('id').executeTakeFirstOrThrow();
    await db.insertInto('navigation_items').values([
      { kind: 'home', label: locale === 'en' ? 'Home' : 'หน้าแรก', locale, location: 'header', owner_id: OWNER, page_id: null, position: 0, url: null },
      { kind: 'page', label: title, locale, location: 'header', owner_id: OWNER, page_id: page.id, position: 1, url: null },
    ]).execute();
    await db.insertInto('home_slides').values({
      body: locale === 'en' ? 'Short essays on making things.' : 'บทความสั้นว่าด้วยการลงมือทำ', button_label: null, heading: locale === 'en' ? 'Quiet Notes' : 'บันทึกเงียบ ๆ',
      link_kind: null, locale, media_id: pictures[0], owner_id: OWNER, page_id: null, position: 0, url: null,
    } as never).execute();
  }

  // Sixty days of counts: the last thirty give the Stats screen its shape, and the thirty
  // before that give it something real to compare against, a little lower, so the change
  // reads as tens of percent instead of a comparison against an empty prior period.
  for (let back = 0; back < 60; back += 1) {
    const views = 12 + (((back % 30) * 7) % 19);
    const scaled = back < 30 ? views : Math.max(1, Math.round(views * 0.7));
    await sql`insert into content_stats_daily (owner_id, day, kind, content_id, locale, referrer, device, country, views, reads)
      values (${OWNER}, current_date - ${back}::int, 'post', ${first}, 'en', ${back % 3 ? '' : 'news.example'},
        ${back % 2 ? 'mobile' : 'desktop'}, ${back % 4 ? 'TH' : 'US'}, ${scaled}, ${Math.floor(scaled / 3)})`.execute(db);
  }
  return first;
}
