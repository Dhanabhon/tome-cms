import { expect, test, type APIRequestContext, type BrowserContext } from '@playwright/test';
import type { APIRoute } from 'astro';
import { createContext } from 'astro/middleware';

import type { NavigationMutationItem, Page, PageLocale } from '../../src/types/cms';
import { admin, createOwner, deleteOwner, leaseSiteOwner, signInAdmin } from './support';

const contentHtml = '<h1>Body heading</h1><p onclick="steal()">Visible without JavaScript.</p><script>alert("unsafe")</script><a href="javascript:steal()">Safe link</a>';
const contentJson = { type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Visible without JavaScript.' }] }] };

async function createPage(request: APIRequestContext, locale: PageLocale, slug: string, sourcePageId?: string, status = 'published') {
  const response = await request.post('/api/pages', {
    data: { contentHtml, contentJson, ...(sourcePageId ? { locale, sourcePageId } : {}), metaTitle: `${locale} Page metadata`, slug, status, title: `${locale} Public Page` },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).page as Page;
}

function expectNoPublicScripts(rawHtml: string) {
  // The E2E harness uses Astro dev; remove only its injected HMR, toolbar, and CSS module scripts.
  const html = rawHtml.replace(
    /<script[^>]+type=["']module["'][^>]+src=["'](?:\/@vite\/client|\/@fs\/[^"']+\/astro\/dist\/runtime\/client\/dev-toolbar\/entrypoint\.js[^"']*|\/node_modules\/@astrojs\/tailwind\/base\.css|\/src\/styles\/global\.css|\/src\/components\/LanguageSwitcher\.astro\?astro&type=style&index=0&lang\.css)["'][^>]*><\/script>/gi,
    '',
  );
  expect(html.match(/<script(?![^>]*type=["']application\/ld\+json["'])[^>]*>/gi) ?? []).toEqual([]);
  expect(html).not.toContain('astro-island');
  expect(html).not.toContain('data-page-transition');
  expect(html).not.toMatch(/steal\(\)|alert\("unsafe"\)/);
}

test('Page settings provider failures return 500 while invalid and reserved routes stay 404', async ({ request }, testInfo) => {
  const { dev } = await import('astro');
  const server = await dev({
    logLevel: 'error', server: { host: '127.0.0.1', port: 0 },
    vite: { cacheDir: testInfo.outputPath('astro-vite-cache'), server: { hmr: false, watch: null } },
  });
  const originalFetch = globalThis.fetch;
  let failedSettingsReads = 0;
  const pageQueries: string[] = [];
  try {
    // Use a fresh Astro server so settings caches cannot mask this provider-boundary failure.
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === '/rest/v1/pages') pageQueries.push(url.search);
      // Keep the middleware's installed-state probe healthy; fail the full settings read.
      if (url.pathname === '/rest/v1/site_settings' && url.searchParams.get('select') === '*') {
        failedSettingsReads++;
        return Response.json({ code: 'XX000', message: 'Private settings provider diagnostic' }, { status: 500 });
      }
      return originalFetch(input, init);
    };
    for (const [path, status, message] of [
      ['/fr/example', 404, 'Page not found.'],
      ['/th/blog', 404, 'Page not found.'],
      ['/th/example', 500, 'This page is temporarily unavailable.'],
    ] as const) {
      const response = await request.get(`http://127.0.0.1:${server.address.port}${path}`);
      expect(response.status(), path).toBe(status);
      const html = await response.text();
      expect(html).toContain(message);
      expect(html).toContain('<meta name="robots" content="noindex, follow">');
      expect(html).not.toContain('application/ld+json');
      expect(html).not.toContain('Private settings provider diagnostic');
    }
    expect(failedSettingsReads).toBeGreaterThan(0);
    expect(pageQueries).toEqual([]);
  } finally {
    globalThis.fetch = originalFetch;
    await server.stop();
  }
});

test('published Pages have exact-locale owner-scoped HTML and WebPage metadata without JavaScript', async ({ browser, page }) => {
  const owner = await createOwner('public-pages');
  const foreign = await createOwner('public-pages-foreign');
  let restoreOwner: (() => Promise<void>) | undefined;
  let noScriptContext: BrowserContext | undefined;
  try {
    restoreOwner = await leaseSiteOwner(owner);
    // The web-server readiness request may have cached the previous installed owner for five seconds.
    await page.waitForTimeout(5_100);
    const { data: settings, error } = await admin.from('site_settings').select('default_locale, site_name').eq('id', true).single();
    if (error) throw error;
    await signInAdmin(page, owner);
    const locale = settings.default_locale as PageLocale;
    const siblingLocale = locale === 'th' ? 'en' : 'th';
    const slug = `public-page-${crypto.randomUUID()}`;
    const source = await createPage(page.request, locale, slug);
    const sibling = await createPage(page.request, siblingLocale, slug, source.id, 'draft');
    const foreignSlug = `foreign-${crypto.randomUUID()}`;
    const { error: foreignError } = await foreign.client.from('pages').insert({
      author_id: foreign.id, content_html: '<p>Foreign private edition</p>', content_json: contentJson,
      locale, slug: foreignSlug, status: 'published', title: 'Foreign Page',
    });
    if (foreignError) throw foreignError;
    // Public rendering must sanitize persisted HTML, including rows written outside the CMS API.
    const { error: contentError } = await owner.client.from('pages').update({ content_html: contentHtml }).eq('id', source.id);
    if (contentError) throw contentError;

    noScriptContext = await browser.newContext({ javaScriptEnabled: false });
    const publicPage = await noScriptContext.newPage();
    const response = await publicPage.goto(`/${locale}/${slug}`);
    expect(response?.status()).toBe(200);
    await expect(publicPage.locator('html')).toHaveAttribute('lang', locale);
    await expect(publicPage).toHaveTitle(`${locale} Page metadata | ${settings.site_name}`);
    await expect(publicPage.getByRole('heading', { level: 1 })).toHaveText(`${locale} Public Page`);
    await expect(publicPage.getByRole('heading', { level: 2, name: 'Body heading' })).toBeVisible();
    await expect(publicPage.getByText('Visible without JavaScript.')).toBeVisible();
    await expect(publicPage.locator('meta[name="description"]')).toHaveAttribute('content', 'Visible without JavaScript.');
    await expect(publicPage.locator('meta[property="og:type"]')).toHaveAttribute('content', 'website');
    await expect(publicPage.locator('meta[property="og:title"]')).toHaveAttribute('content', `${locale} Page metadata | ${settings.site_name}`);
    await expect(publicPage.locator('meta[property="og:locale"]')).toHaveAttribute('content', locale === 'th' ? 'th_TH' : 'en_US');
    await expect(publicPage.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary');
    await expect(publicPage.locator('meta[name="twitter:description"]')).toHaveAttribute('content', 'Visible without JavaScript.');
    const canonical = publicPage.url();
    await expect(publicPage.locator('link[rel="canonical"]')).toHaveAttribute('href', canonical);
    await expect(publicPage.locator('meta[property="og:url"]')).toHaveAttribute('content', canonical);
    await expect(publicPage.locator('link[rel="alternate"]')).toHaveCount(2);
    await expect(publicPage.locator('link[hreflang="x-default"]')).toHaveAttribute('href', canonical);
    await expect(publicPage.locator(`link[hreflang="${siblingLocale}"]`)).toHaveCount(0);
    await expect(publicPage.locator('meta[name="author"], meta[property^="article:"], article time, article aside, article img')).toHaveCount(0);
    const structuredData = JSON.parse((await publicPage.locator('script[type="application/ld+json"]').textContent()) ?? '{}') as Record<string, unknown>;
    expect(structuredData).toEqual({
      '@context': 'https://schema.org', '@type': 'WebPage', description: 'Visible without JavaScript.',
      inLanguage: locale, isPartOf: { '@type': 'WebSite', name: settings.site_name, url: new URL('/', canonical).href },
      name: `${locale} Public Page`, publisher: { '@type': 'Organization', name: settings.site_name, url: new URL('/', canonical).href }, url: canonical,
    });
    expectNoPublicScripts(await response!.text());

    for (const path of [`/${siblingLocale}/${slug}`, `/${locale}/missing-${slug}`, `/fr/${slug}`, `/${locale}/blog`, `/${locale}/${foreignSlug}`]) {
      expect((await publicPage.goto(path))?.status(), path).toBe(404);
      await expect(publicPage.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
      await expect(publicPage.locator('script[type="application/ld+json"]')).toHaveCount(0);
      await expect(publicPage.getByText('Visible without JavaScript.')).toHaveCount(0);
      await expect(publicPage.getByText('Foreign private edition')).toHaveCount(0);
    }

    expect((await page.request.patch('/api/pages', { data: { id: sibling.id, status: 'published' } })).status()).toBe(200);
    await publicPage.goto(`/${locale}/${slug}`);
    await expect(publicPage.locator('link[rel="alternate"]')).toHaveCount(3);
    await expect(publicPage.locator(`link[hreflang="${siblingLocale}"]`)).toHaveAttribute('href', new URL(`/${siblingLocale}/${slug}`, canonical).href);
    await publicPage.getByRole('button', { name: /Change language/ }).click();
    await publicPage.getByRole('navigation', { name: 'Choose language' }).getByRole('link', { name: siblingLocale === 'th' ? 'ไทย' : 'English (US)' }).click();
    await expect(publicPage.locator('html')).toHaveAttribute('lang', siblingLocale);
    await expect(publicPage.getByRole('heading', { level: 1 })).toHaveText(`${siblingLocale} Public Page`);

    expect((await page.request.patch('/api/pages', { data: { id: source.id, status: 'draft' } })).status()).toBe(200);
    await publicPage.reload();
    await expect(publicPage.locator('link[rel="alternate"]')).toHaveCount(1);
    await expect(publicPage.locator('link[hreflang="x-default"]')).toHaveCount(0);
    expect((await publicPage.goto(`/${locale}/${slug}`))?.status()).toBe(404);
    await expect(publicPage.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  } finally {
    await noScriptContext?.close();
    await admin.from('pages').delete().in('author_id', [owner.id, foreign.id]);
    if (restoreOwner) await restoreOwner();
    await deleteOwner(owner);
    await deleteOwner(foreign);
  }
});

test('sitemap lists every published owner Page edition and fails closed if either content query fails', async ({ page, request }, testInfo) => {
  const owner = await createOwner('page-sitemap');
  const foreign = await createOwner('page-sitemap-foreign');
  let restoreOwner: (() => Promise<void>) | undefined;
  const originalFetch = globalThis.fetch;
  const { createServer } = await import('vite');
  const vite = await createServer({
    configFile: false, envPrefix: 'PUBLIC_', appType: 'custom', cacheDir: testInfo.outputPath('vite-cache'),
    server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
  });
  try {
    restoreOwner = await leaseSiteOwner(owner);
    await page.waitForTimeout(5_100);
    const { data: settings, error } = await admin.from('site_settings').select('default_locale').eq('id', true).single();
    if (error) throw error;
    await signInAdmin(page, owner);
    const locale = settings.default_locale as PageLocale;
    const source = await createPage(page.request, locale, `sitemap-${crypto.randomUUID()}`);
    const sibling = await createPage(page.request, locale === 'th' ? 'en' : 'th', source.slug, source.id);
    const draft = await createPage(page.request, locale, `sitemap-draft-${crypto.randomUUID()}`, undefined, 'draft');
    const foreignSlug = `foreign-sitemap-${crypto.randomUUID()}`;
    const { error: foreignError } = await foreign.client.from('pages').insert({
      author_id: foreign.id, locale, slug: foreignSlug, status: 'published', title: 'Foreign sitemap Page',
      content_html: '<p>Foreign Page</p>', content_json: contentJson,
    });
    if (foreignError) throw foreignError;
    const response = await request.get('/sitemap.xml');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/xml');
    const xml = await response.text();
    for (const edition of [source, sibling]) {
      expect(xml).toContain(`<loc>${new URL(`/${edition.locale}/${edition.slug}`, response.url()).href}</loc>`);
      expect(xml).toContain(`<lastmod>${edition.updated_at}</lastmod>`);
    }
    expect(xml).not.toContain(draft.slug);
    expect(xml).not.toContain(foreignSlug);
    expect(xml).not.toContain('/admin/pages/preview/');

    await page.context().clearCookies();
    await signInAdmin(page, foreign);
    const signedInSitemap = await page.request.get('/sitemap.xml');
    expect(signedInSitemap.status()).toBe(200);
    const signedInXml = await signedInSitemap.text();
    expect(signedInXml).toContain(`/${source.locale}/${source.slug}`);
    expect(signedInXml).toContain(`/${sibling.locale}/${sibling.slug}`);
    expect(signedInXml).not.toContain(foreignSlug);

    const { GET } = await vite.ssrLoadModule('/src/pages/sitemap.xml.ts') as { GET: APIRoute };
    for (const table of ['posts', 'pages']) {
      globalThis.fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.pathname === `/rest/v1/${table}`) {
          return Response.json({ code: 'XX000', message: `Simulated ${table} failure` }, { status: 500 });
        }
        return originalFetch(input, init);
      };
      const failed = await GET(createContext({ request: new Request(response.url()), defaultLocale: locale, locals: {} }));
      expect(failed.status, table).toBe(503);
      expect(failed.headers.get('cache-control')).toBe('no-store');
      expect(await failed.text()).toBe('Sitemap is temporarily unavailable.\n');
    }
  } finally {
    globalThis.fetch = originalFetch;
    await vite.close();
    await admin.from('pages').delete().in('author_id', [owner.id, foreign.id]);
    if (restoreOwner) await restoreOwner();
    await deleteOwner(owner);
    await deleteOwner(foreign);
  }
});

test('independent locale menus and Page visibility work on desktop and native mobile navigation without JavaScript', async ({ browser, page }) => {
  test.setTimeout(60_000);
  const owner = await createOwner('public-menus');
  let restoreOwner: (() => Promise<void>) | undefined;
  let noScriptContext: BrowserContext | undefined;
  try {
    restoreOwner = await leaseSiteOwner(owner);
    await page.waitForTimeout(5_100);
    const { data: settings, error } = await admin.from('site_settings').select('default_locale').eq('id', true).single();
    if (error) throw error;
    await signInAdmin(page, owner);
    const locale = settings.default_locale as PageLocale;
    const source = await createPage(page.request, locale, `menu-${crypto.randomUUID()}`);
    const sibling = await createPage(page.request, locale === 'th' ? 'en' : 'th', source.slug, source.id);
    const draft = await createPage(page.request, locale, `hidden-${crypto.randomUUID()}`, undefined, 'draft');
    for (const edition of [source, sibling]) {
      for (const location of ['header', 'footer'] as const) {
        const suffix = location === 'footer' ? ' footer' : '';
        const home: NavigationMutationItem = { kind: 'home', label: `${edition.locale} Home${suffix}`, pageId: null, url: null };
        const about: NavigationMutationItem = { kind: 'page', label: `${edition.locale} About${suffix}`, pageId: edition.id, url: null };
        const contact: NavigationMutationItem = { kind: 'custom', label: `${edition.locale} Contact${suffix}`, pageId: null, url: location === 'header' ? `/${edition.locale}#contact` : 'https://example.com/contact' };
        const items = location === 'header' ? [home, about, contact] : [contact, about, home];
        if (edition.id === source.id) items.splice(1, 0, { kind: 'page', label: 'Hidden Page', pageId: draft.id, url: null });
        expect((await page.request.put('/api/navigation', { data: { items, locale: edition.locale, location } })).status()).toBe(200);
      }
    }

    noScriptContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 } });
    const publicPage = await noScriptContext.newPage();
    for (const edition of [source, sibling]) {
      const response = await publicPage.goto(`/${edition.locale}`);
      expect(response?.status()).toBe(200);
      const primary = publicPage.getByRole('navigation', { name: 'Primary', exact: true });
      const footer = publicPage.getByRole('navigation', { name: 'Footer', exact: true });
      await expect(primary.getByRole('link')).toHaveText([`${edition.locale} Home`, `${edition.locale} About`, `${edition.locale} Contact`]);
      await expect(footer.getByRole('link')).toHaveText([`${edition.locale} Contact footer`, `${edition.locale} About footer`, `${edition.locale} Home footer`]);
      await expect(primary.getByRole('link', { name: `${edition.locale} Contact`, exact: true })).toHaveAttribute('href', `/${edition.locale}#contact`);
      await expect(footer.getByRole('link', { name: `${edition.locale} Contact footer` })).toHaveAttribute('href', 'https://example.com/contact');
      await expect(publicPage.locator('header a[target], footer a[target]')).toHaveCount(0);
      await expect(publicPage.getByRole('link', { name: 'Hidden Page', exact: true })).toHaveCount(0);
      expectNoPublicScripts(await response!.text());
      await primary.getByRole('link', { name: `${edition.locale} About`, exact: true }).click();
      await expect(publicPage.getByRole('heading', { level: 1 })).toHaveText(`${edition.locale} Public Page`);
      await footer.getByRole('link', { name: `${edition.locale} Home footer` }).click();
      await expect(publicPage).toHaveURL(new RegExp(`/${edition.locale}$`));
    }

    await publicPage.goto(`/${locale}/${source.slug}`);
    for (const width of [320, 375, 414, 768, 1280, 1440]) {
      await publicPage.setViewportSize({ width, height: 900 });
      const disclosure = publicPage.locator('header details');
      if (width < 768) {
        await expect(disclosure).toBeVisible();
        const summary = disclosure.locator('summary');
        await summary.focus();
        await expect(summary).toBeFocused();
        if (await disclosure.getAttribute('open') === null) await summary.press('Enter');
        await expect(disclosure).toHaveAttribute('open', '');
        await expect(disclosure.getByRole('link')).toHaveText([`${locale} Home`, `${locale} About`, `${locale} Contact`]);
        await summary.press('Tab');
        await expect(disclosure.getByRole('link').first()).toBeFocused();
        await disclosure.getByRole('link').first().press('Enter');
        await expect(publicPage).toHaveURL(new RegExp(`/${locale}$`));
        await publicPage.goto(`/${locale}/${source.slug}`);
        await publicPage.locator('header details summary').press('Enter');
      } else {
        await expect(disclosure).toBeHidden();
        await expect(publicPage.getByRole('navigation', { name: 'Primary', exact: true })).toBeVisible();
      }
      expect(await publicPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}px overflow`).toBe(true);
      for (const link of await publicPage.locator('header nav[aria-label="Primary"] a:visible, footer nav a:visible').all()) {
        await expect(link).toHaveCSS('white-space', 'nowrap');
        const bounds = await link.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      }
    }
    await publicPage.emulateMedia({ reducedMotion: 'reduce' });
    await expect(publicPage.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('link').first()).toHaveCSS('transition-duration', '0s');

    expect((await page.request.patch('/api/pages', { data: { id: draft.id, status: 'published' } })).status()).toBe(200);
    await expect.poll(async () => {
      await publicPage.reload();
      return publicPage.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('link', { name: 'Hidden Page' }).count();
    }, { timeout: 7_000 }).toBe(1);
    expect((await page.request.patch('/api/pages', { data: { id: draft.id, status: 'draft' } })).status()).toBe(200);
    expect((await publicPage.request.get(`/${locale}/${draft.slug}`)).status()).toBe(404);
    await expect.poll(async () => {
      await publicPage.reload();
      return publicPage.getByRole('link', { name: 'Hidden Page' }).count();
    }, { timeout: 7_000 }).toBe(0);
    expect((await page.request.patch('/api/pages', { data: { id: draft.id, status: 'published' } })).status()).toBe(200);
    await expect.poll(async () => {
      await publicPage.reload();
      return publicPage.getByRole('link', { name: 'Hidden Page' }).count();
    }, { timeout: 7_000 }).toBe(2);
    expect((await page.request.delete(`/api/pages?id=${draft.id}`)).status()).toBe(204);
    expect((await publicPage.request.get(`/${locale}/${draft.slug}`)).status()).toBe(404);
    await expect.poll(async () => {
      await publicPage.reload();
      return publicPage.getByRole('link', { name: 'Hidden Page' }).count();
    }, { timeout: 7_000 }).toBe(0);
    await publicPage.goto(`/${sibling.locale}/${sibling.slug}`);
    await expect(publicPage.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('link')).toHaveCount(3);

    const longLabel = 'Long navigation label '.repeat(4).slice(0, 80);
    expect((await page.request.put('/api/navigation', {
      data: { locale, location: 'header', items: [{ kind: 'custom', label: longLabel, pageId: null, url: '/contact' }] },
    })).status()).toBe(200);
    await publicPage.setViewportSize({ width: 320, height: 900 });
    await publicPage.goto(`/${locale}/${source.slug}`);
    await publicPage.locator('header details summary').press('Enter');
    const longLink = publicPage.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('link');
    await expect(longLink).toHaveText(longLabel.trim());
    await expect(longLink).toHaveCSS('white-space', 'nowrap');
    await expect(longLink).toHaveCSS('overflow-x', 'auto');
    expect(await publicPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const bounds = await longLink.boundingBox();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  } finally {
    await noScriptContext?.close();
    await admin.from('navigation_items').delete().eq('owner_id', owner.id);
    await admin.from('pages').delete().eq('author_id', owner.id);
    if (restoreOwner) await restoreOwner();
    await deleteOwner(owner);
  }
});
