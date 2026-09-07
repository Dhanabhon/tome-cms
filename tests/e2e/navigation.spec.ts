import { expect, test } from '@playwright/test';
import { createContext } from 'astro/middleware';

import type { APIRoute } from 'astro';
import type { NavigationItem, PageLocale, PublicNavigationItem } from '../../src/types/cms';
import { admin, createOwner, deleteOwner, leaseSiteOwner, signInAdmin, type TestOwner } from './support';

const home = (label = 'Home') => ({ kind: 'home', label, pageId: null, url: null });
const custom = (url: string, label = 'Link') => ({ kind: 'custom', label, pageId: null, url });
const pageItem = (pageId: string) => ({ kind: 'page', label: 'Page', pageId, url: null });
const menu = (items: unknown[], locale = 'th', location = 'header') => ({ locale, location, items });

async function seedPage(owner: TestOwner, locale: PageLocale, status = 'draft') {
  const { data, error } = await owner.client.from('pages').insert({
    author_id: owner.id, locale, status, title: `${locale} ${status}`,
    slug: `navigation-${crypto.randomUUID()}`,
    content_json: { type: 'doc', content: [] }, content_html: '<p>Private content</p>',
  }).select('id, translation_group_id, locale, title, slug, status').single();
  if (error || !data) throw error ?? new Error('Page was not created.');
  return data as { id: string; translation_group_id: string; locale: PageLocale; title: string; slug: string; status: string };
}

async function cleanup(...owners: TestOwner[]) {
  for (const owner of owners) {
    const { error: navigationError } = await admin.from('navigation_items').delete().eq('owner_id', owner.id);
    if (navigationError) throw navigationError;
    const { error: pagesError } = await admin.from('pages').delete().eq('author_id', owner.id);
    if (pagesError) throw pagesError;
    await deleteOwner(owner);
  }
}

test('navigation requires authentication', async ({ request }) => {
  expect((await request.get('/api/navigation')).status()).toBe(401);
  expect((await request.put('/api/navigation', { data: menu([]) })).status()).toBe(401);
});

test('navigation returns only owned summaries and saves four independent ordered menus', async ({ page }) => {
  const owner = await createOwner('navigation-lists');
  const foreign = await createOwner('navigation-foreign');
  try {
    const draft = await seedPage(owner, 'th');
    await seedPage(foreign, 'th', 'published');
    const { error } = await foreign.client.rpc('replace_navigation_items', {
      target_locale: 'th', target_location: 'header',
      menu_items: [{ kind: 'home', label: 'Foreign menu', page_id: null, url: null }],
    });
    if (error) throw error;
    await signInAdmin(page, owner);
    const initial = await page.request.get('/api/navigation');
    expect(initial.status()).toBe(200);
    expect(await initial.json()).toEqual({ items: [], pages: [draft] });

    for (const locale of ['th', 'en']) {
      for (const location of ['header', 'footer']) {
        const response = await page.request.put('/api/navigation', {
          data: menu([custom(`/${locale}/${location}`), home(` ${locale} ${location} `)], locale, location),
        });
        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body.items.map((item: NavigationItem) => item.position)).toEqual([0, 1]);
        expect(body.items[1].label).toBe(`${locale} ${location}`);
        expect(JSON.stringify(body)).not.toMatch(/owner_id|author_id|content_html|content_json/);
      }
    }
    const draftResponse = await page.request.put('/api/navigation', { data: menu([pageItem(draft.id)]) });
    expect(draftResponse.status()).toBe(200);
    const listed = await page.request.get('/api/navigation');
    const body = await listed.json();
    expect(body.pages).toEqual([draft]);
    expect(body.items.map((item: NavigationItem) => `${item.locale}/${item.location}/${item.position}`)).toEqual([
      'en/footer/0', 'en/footer/1', 'en/header/0', 'en/header/1', 'th/footer/0', 'th/footer/1', 'th/header/0',
    ]);
    expect(body.items.at(-1).page_id).toBe(draft.id);
    expect(JSON.stringify(body)).not.toMatch(/owner_id|author_id|content_html|content_json|Foreign menu/);
  } finally {
    await cleanup(owner, foreign);
  }
});

test('navigation rejects malformed, oversized, mismatched and duplicate payloads without replacing a saved menu', async ({ page }) => {
  const owner = await createOwner('navigation-validation');
  const foreign = await createOwner('navigation-target');
  try {
    const draft = await seedPage(owner, 'th');
    const english = await seedPage(owner, 'en');
    const foreignPage = await seedPage(foreign, 'th', 'published');
    await signInAdmin(page, owner);
    const saved = await page.request.put('/api/navigation', { data: menu([home()]) });
    expect(saved.status()).toBe(200);
    const original = (await saved.json()).items;
    expect((await page.request.put('/api/navigation', {
      data: Buffer.from('{'), headers: { 'content-type': 'application/json' },
    })).status()).toBe(400);

    const invalid = [
      null, {}, menu([], 'fr'), menu([], 'th', 'sidebar'), { ...menu([]), owner_id: owner.id },
      { ...menu([]), author_id: owner.id }, { ...menu([]), translation_group_id: crypto.randomUUID() },
      menu([{ ...home(), position: 4 }]), menu([{ ...home(), page_id: draft.id }]),
      menu([{ ...home(), owner_id: owner.id }]), menu([{ ...home(), pageId: draft.id }]),
      menu([{ ...home(), url: '/path' }]), menu([{ kind: 'home', label: 'Missing target fields' }]),
      menu([{ ...pageItem(draft.id), url: '/path' }]), menu([pageItem('invalid')]),
      menu([{ ...custom('/path'), pageId: draft.id }]), menu([{ ...custom('/path'), url: null }]),
      menu([{ ...home(), kind: 'post' }]), menu([home('')]), menu([home('  ')]), menu([home('a'.repeat(81))]),
      menu(Array.from({ length: 51 }, (_, index) => custom(`/item-${index}`))),
      menu([custom('/' + 'a'.repeat(2048))]), menu([home(), home('Other')]),
      menu([pageItem(draft.id), pageItem(draft.id)]), menu([pageItem(draft.id), pageItem(draft.id.toUpperCase())]),
      menu([custom(' HTTPS://EXAMPLE.COM:443 '), custom('https://example.com/')]),
      menu([custom(' /same '), custom('/same')]),
      menu([pageItem(english.id)]), menu([pageItem(foreignPage.id)]), menu([pageItem(crypto.randomUUID())]),
      ...['//evil.test', '/\\evil.test', 'relative/path', '#fragment', 'javascript:alert(1)', 'data:text/html,evil',
        'mailto:owner@example.com', 'ftp://example.com', 'https://example.com/a b', '/a\nb', 'https://', '/a\u0000b',
        `https://example.com/${'ก'.repeat(300)}`].map((url) => menu([custom(url)])),
    ];
    for (const data of invalid) {
      const response = await page.request.put('/api/navigation', { data });
      expect(response.status(), JSON.stringify(data)).toBe(400);
      expect(await response.text()).not.toContain(foreign.id);
    }
    const listed = await page.request.get('/api/navigation');
    expect((await listed.json()).items).toEqual(original);
  } finally {
    await cleanup(owner, foreign);
  }
});

test('navigation accepts label/item limits and normalizes safe URLs', async ({ page }) => {
  const owner = await createOwner('navigation-normalize');
  try {
    await signInAdmin(page, owner);
    const response = await page.request.put('/api/navigation', {
      data: menu([
        custom(' HTTPS://EXAMPLE.COM:443/a/../b?x=1#part ', 'a'.repeat(80)),
        custom('http://EXAMPLE.COM:80'), custom(' /th/about?x=1#part '),
        custom('/' + 'a'.repeat(2047)),
      ]),
    });
    expect(response.status()).toBe(200);
    expect((await response.json()).items.map((item: NavigationItem) => item.url)).toEqual([
      'https://example.com/b?x=1#part', 'http://example.com/', '/th/about?x=1#part', '/' + 'a'.repeat(2047),
    ]);
    const maximum = await page.request.put('/api/navigation', {
      data: menu(Array.from({ length: 50 }, (_, index) => custom(`/item-${index}`))),
    });
    expect(maximum.status()).toBe(200);
    expect((await maximum.json()).items).toHaveLength(50);
    const emptied = await page.request.put('/api/navigation', { data: menu([]) });
    expect(emptied.status()).toBe(200);
    expect(await emptied.json()).toEqual({ items: [] });
  } finally {
    await cleanup(owner);
  }
});

test('navigation RPC failure rolls back replacement and unexpected errors stay generic', async ({ page }, testInfo) => {
  const owner = await createOwner('navigation-rollback');
  const { createServer } = await import('vite');
  const vite = await createServer({
    configFile: false, envPrefix: 'PUBLIC_', appType: 'custom', cacheDir: testInfo.outputPath('vite-cache'),
    server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
  });
  const originalFetch = globalThis.fetch;
  try {
    await signInAdmin(page, owner);
    const saved = await page.request.put('/api/navigation', { data: menu([home('Saved')]) });
    expect(saved.status()).toBe(200);
    const original = (await saved.json()).items;
    const { PUT, GET } = await vite.ssrLoadModule('/src/pages/api/navigation/index.ts') as { PUT: APIRoute; GET: APIRoute };
    const cookie = (await page.context().cookies()).map(({ name, value }) => `${name}=${value}`).join('; ');
    const context = (method: string) => createContext({
      request: new Request(new URL('/api/navigation', page.url()), {
        method, headers: { cookie, 'content-type': 'application/json' },
        ...(method === 'PUT' ? { body: JSON.stringify(menu([home('Changed')])) } : {}),
      }), defaultLocale: 'en', locals: {},
    });
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === '/rest/v1/rpc/replace_navigation_items') {
        const body = JSON.parse(String(init?.body));
        body.menu_items.push({ kind: 'page', label: 'Missing', page_id: crypto.randomUUID(), url: null });
        return originalFetch(input, { ...init, body: JSON.stringify(body) });
      }
      return originalFetch(input, init);
    };
    const failed = await PUT(context('PUT'));
    expect(failed.status).toBe(400);
    expect((await page.request.get('/api/navigation').then((response) => response.json())).items).toEqual(original);

    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname.startsWith('/rest/v1/')) {
        return Response.json({ code: 'XX000', message: `Private database failure ${owner.id}`, details: 'Private content', hint: '' }, { status: 500 });
      }
      return originalFetch(input, init);
    };
    for (const response of [await PUT(context('PUT')), await GET(context('GET'))]) {
      expect(response.status).toBe(500);
      const body = await response.text();
      expect(body).not.toMatch(/Private|XX000/);
      expect(body).not.toContain(owner.id);
    }
  } finally {
    globalThis.fetch = originalFetch;
    await vite.close();
    await cleanup(owner);
  }
});

test('public resolver filters owner and published locale, caches for five seconds, and PUT invalidates it', async ({ page }, testInfo) => {
  const owner = await createOwner('navigation-public');
  const foreign = await createOwner('navigation-public-foreign');
  const restore = await leaseSiteOwner(owner);
  const { createServer } = await import('vite');
  const vite = await createServer({
    configFile: false, envPrefix: 'PUBLIC_', appType: 'custom', cacheDir: testInfo.outputPath('vite-cache'),
    server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
  });
  const originalFetch = globalThis.fetch;
  try {
    const published = await seedPage(owner, 'th', 'published');
    const draft = await seedPage(owner, 'th');
    await seedPage(foreign, 'th', 'published');
    await signInAdmin(page, owner);
    expect((await page.request.put('/api/navigation', { data: menu([home(), pageItem(draft.id), pageItem(published.id), custom('/contact')]) })).status()).toBe(200);
    expect((await page.request.put('/api/navigation', { data: menu([home('English')], 'en') })).status()).toBe(200);
    expect((await page.request.put('/api/navigation', { data: menu([custom('https://example.com')], 'th', 'footer') })).status()).toBe(200);
    const { getPublicNavigation, invalidatePublicNavigationCache } = await vite.ssrLoadModule('/src/lib/navigation.ts') as {
      getPublicNavigation: (locale: PageLocale) => Promise<{ header: PublicNavigationItem[]; footer: PublicNavigationItem[] }>;
      invalidatePublicNavigationCache: () => void;
    };
    const queries: URL[] = [];
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === '/rest/v1/navigation_items' || url.pathname === '/rest/v1/pages') queries.push(url);
      return originalFetch(input, init);
    };
    const initial = await getPublicNavigation('th');
    expect(initial).toEqual({
      header: [
        { href: '/th', label: 'Home', kind: 'home' },
        { href: `/th/${published.slug}`, label: 'Page', kind: 'page' },
        { href: '/contact', label: 'Link', kind: 'custom' },
      ], footer: [{ href: 'https://example.com/', label: 'Link', kind: 'custom' }],
    });
    expect(queries[0].searchParams.get('owner_id')).toBe(`eq.${owner.id}`);
    expect(queries[0].searchParams.get('locale')).toBe('eq.th');
    expect(queries[0].searchParams.get('limit')).toBe('100');
    expect(queries[0].searchParams.get('select')).toBe('id,kind,label,location,page_id,position,url');
    expect(queries[1].searchParams.get('select')).toBe('id,slug');
    expect(queries[1].searchParams.get('author_id')).toBe(`eq.${owner.id}`);
    expect(queries[1].searchParams.get('locale')).toBe('eq.th');
    expect(queries[1].searchParams.get('status')).toBe('eq.published');
    expect(await getPublicNavigation('en')).toEqual({ header: [{ href: '/en', label: 'English', kind: 'home' }], footer: [] });
    const { error } = await owner.client.from('pages').update({ status: 'published' }).eq('id', draft.id);
    if (error) throw error;
    const count = queries.length;
    expect(await getPublicNavigation('th')).toEqual(initial);
    expect(queries).toHaveLength(count);
    await expect.poll(async () => (await getPublicNavigation('th')).header.length, {
      timeout: 6_000, intervals: [250],
    }).toBe(4);

    const { PUT } = await vite.ssrLoadModule('/src/pages/api/navigation/index.ts') as { PUT: APIRoute };
    const cookie = (await page.context().cookies()).map(({ name, value }) => `${name}=${value}`).join('; ');
    const response = await PUT(createContext({
      request: new Request(new URL('/api/navigation', page.url()), {
        method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(menu([home('Updated')])),
      }), defaultLocale: 'en', locals: {},
    }));
    expect(response.status).toBe(200);
    expect((await getPublicNavigation('th')).header).toEqual([{ href: '/th', label: 'Updated', kind: 'home' }]);

    invalidatePublicNavigationCache();
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === '/rest/v1/navigation_items') {
        return Response.json({ code: 'XX000', message: 'Private read failure', details: '', hint: '' }, { status: 500 });
      }
      return originalFetch(input, init);
    };
    expect(await getPublicNavigation('th')).toEqual({ header: [], footer: [] });
  } finally {
    globalThis.fetch = originalFetch;
    await vite.close();
    await restore();
    await cleanup(owner, foreign);
  }
});
