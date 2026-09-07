import { expect, test, type Page } from '@playwright/test';
import { createContext } from 'astro/middleware';

import type { APIRoute } from 'astro';
import type { NavigationItem, PageLocale, PublicNavigationItem } from '../../src/types/cms';
import { admin, createOwner, deleteOwner, leaseSiteOwner, signInAdmin, type TestOwner } from './support';

const home = (label = 'Home') => ({ kind: 'home', label, pageId: null, url: null });
const custom = (url: string, label = 'Link') => ({ kind: 'custom', label, pageId: null, url });
const pageItem = (pageId: string) => ({ kind: 'page', label: 'Page', pageId, url: null });
const menu = (items: unknown[], locale = 'th', location = 'header') => ({ locale, location, items });

async function chooseNavigationOption(page: Page, field: string, option: string) {
  await page.getByRole('combobox', { name: field, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function addNavigationItem(page: Page, kind: string, label: string, placement?: string, target?: string) {
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await page.getByRole('radio', { name: kind, exact: true }).check();
  if (kind === 'Page') await chooseNavigationOption(page, 'Page', target!);
  if (kind === 'Custom URL') await page.getByRole('textbox', { name: 'URL', exact: true }).fill(target!);
  await page.getByRole('textbox', { name: 'Label', exact: true }).fill(label);
  if (placement) await chooseNavigationOption(page, 'Placement', placement);
  await page.getByRole('button', { name: 'Add to menu', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Add navigation item' })).not.toBeVisible();
}

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

test('navigation manager redirects unauthenticated visitors', async ({ page }) => {
  await page.goto('/admin/navigation');
  await expect(page).toHaveURL(/\/admin\?returnTo=%2Fadmin%2Fnavigation$/);
});

test('navigation manager recovers loading and save failures without losing local edits or duplicate submissions', async ({ page }) => {
  const owner = await createOwner('navigation-ui-retry');
  let releaseLoad!: () => void;
  let releaseSave!: () => void;
  const loadGate = new Promise<void>((resolve) => { releaseLoad = resolve; });
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  let loads = 0;
  let saves = 0;
  try {
    await signInAdmin(page, owner);
    await page.route('**/api/navigation', async (route) => {
      if (route.request().method() === 'GET' && ++loads === 1) {
        await loadGate;
        await route.fulfill({ status: 500, json: { error: 'Navigation could not be loaded or saved.' } });
      } else if (route.request().method() === 'PUT' && ++saves <= 2) {
        await saveGate;
        await route.fulfill({ status: 500, json: { error: 'Navigation could not be loaded or saved.' } });
      } else await route.continue();
    });
    await page.goto('/admin/navigation');
    await expect(page.getByRole('heading', { name: 'Navigation', exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('Loading navigation…');
    releaseLoad();
    await expect(page.getByRole('alert')).toContainText('Navigation could not be loaded');
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByText('No items in this menu.')).toBeVisible();
    await addNavigationItem(page, 'Home', 'My home');
    await addNavigationItem(page, 'Custom URL', 'Contact', undefined, '/contact');
    await page.getByRole('list', { name: 'Menu items' }).getByRole('listitem').first().getByRole('button', { name: 'Move down', exact: true }).click();
    await page.getByRole('button', { name: 'Save menu', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Saving…', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    expect(saves).toBe(1);
    releaseSave();
    await expect(page.getByRole('alert')).toContainText('Navigation could not be saved');
    await expect(page.getByRole('textbox', { name: 'Item 1 label' })).toHaveValue('Contact');
    await expect(page.getByRole('textbox', { name: 'Item 2 label' })).toHaveValue('My home');
    await expect(page.getByRole('tab', { name: 'MenuBar', exact: true })).toContainText('Unsaved');
    const retrySave = page.getByRole('button', { name: 'Retry save', exact: true });
    await retrySave.focus();
    await expect(retrySave).toBeFocused();
    await retrySave.press('Enter');
    await expect.poll(() => saves).toBe(2);
    await expect(page.getByRole('button', { name: 'Add item', exact: true })).toBeFocused();
    await expect(page.getByRole('alert')).toContainText('Navigation could not be saved');
    await expect(page.getByRole('textbox', { name: 'Item 1 label' })).toHaveValue('Contact');
    await expect(page.getByRole('textbox', { name: 'Item 2 label' })).toHaveValue('My home');
    await expect(page.getByRole('tab', { name: 'MenuBar', exact: true })).toContainText('Unsaved');
    await retrySave.focus();
    await retrySave.press('Enter');
    await expect(page.getByRole('status')).toHaveText('Menu saved.');
    await expect(page.getByRole('button', { name: 'Add item', exact: true })).toBeFocused();
    expect(saves).toBe(3);
    await expect(page.getByRole('tab', { name: 'MenuBar', exact: true })).not.toContainText('Unsaved');
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Item 1 label' })).toHaveValue('Contact');
    await expect(page.getByRole('textbox', { name: 'Item 2 label' })).toHaveValue('My home');
  } finally {
    releaseLoad(); releaseSave();
    await page.unrouteAll({ behavior: 'wait' });
    await cleanup(owner);
  }
});

test('navigation manager keeps four independent menus and page labels, with exact-language availability', async ({ page }) => {
  const owner = await createOwner('navigation-ui-local');
  try {
    const draft = await seedPage(owner, 'th');
    const english = await seedPage(owner, 'en', 'published');
    await signInAdmin(page, owner);
    await page.goto('/admin/navigation');
    await expect(page.getByRole('heading', { name: 'Navigation', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Add item', exact: true }).click();
    await page.getByRole('radio', { name: 'Page', exact: true }).check();
    await expect(page.getByRole('button', { name: `${english.title} — Missing Thai translation`, exact: true })).toBeDisabled();
    await chooseNavigationOption(page, 'Page', `${draft.title} — Draft`);
    await expect(page.getByRole('textbox', { name: 'Label', exact: true })).toHaveValue(draft.title);
    await chooseNavigationOption(page, 'Placement', 'Both');
    await page.getByRole('button', { name: 'Add to menu', exact: true }).click();
    await expect(page.getByText('Hidden — Draft', { exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Item 1 label' }).fill('Header about');
    await expect(page.getByRole('tab', { name: 'Footer', exact: true })).toContainText('Unsaved');
    await expect(page.getByRole('tab', { name: 'Footer', exact: true })).toHaveAccessibleDescription('Unsaved');
    await page.getByRole('tab', { name: 'Footer', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Item 1 label' })).toHaveValue(draft.title);
    await page.getByRole('textbox', { name: 'Item 1 label' }).fill('Footer about');
    await page.getByRole('button', { name: 'Save menu', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Menu saved.');
    const savedFooter = (await page.request.get('/api/navigation').then((response) => response.json())).items as NavigationItem[];
    expect(savedFooter.map(({ label, location, locale }) => ({ label, location, locale }))).toEqual([{ label: 'Footer about', location: 'footer', locale: 'th' }]);
    await expect(page.getByRole('tab', { name: 'MenuBar', exact: true })).toContainText('Unsaved');
    await page.getByRole('tab', { name: 'English', exact: true }).click();
    await addNavigationItem(page, 'Page', 'English footer', undefined, english.title);
    await page.getByRole('tab', { name: 'MenuBar', exact: true }).click();
    await addNavigationItem(page, 'Home', 'English home', 'MenuBar');
    await page.getByRole('tab', { name: 'ไทย', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Item 1 label' })).toHaveValue('Header about');
    await page.getByRole('button', { name: 'Save menu', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Menu saved.');
    await expect(page.getByRole('tab', { name: 'English', exact: true })).toContainText('Unsaved');
    const { error } = await owner.client.from('pages').update({ title: 'Renamed page' }).eq('id', draft.id);
    if (error) throw error;
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Item 1 label' })).toHaveValue('Header about');
    await expect(page.getByText('Renamed page', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Footer', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Item 1 label' })).toHaveValue('Footer about');
  } finally {
    await cleanup(owner);
  }
});

test('navigation manager validates targets, reorders by buttons and drag, and restores focus after removal and dialog close', async ({ page }, testInfo) => {
  const owner = await createOwner('navigation-ui-reorder');
  try {
    await signInAdmin(page, owner);
    await page.goto('/admin/navigation');
    await expect(page.getByRole('heading', { name: 'Navigation', exact: true })).toBeVisible();
    await addNavigationItem(page, 'Home', 'Home');
    await addNavigationItem(page, 'Custom URL', 'Contact', 'Footer', '/contact');
    await expect(page.getByRole('textbox', { name: 'Item 2 label' })).toHaveCount(0);
    await addNavigationItem(page, 'Custom URL', 'One', undefined, 'https://EXAMPLE.com:443');
    await addNavigationItem(page, 'Custom URL', 'Two', undefined, '/two');
    await page.getByRole('button', { name: 'Add item', exact: true }).click();
    await page.getByRole('radio', { name: 'Custom URL', exact: true }).check();
    await page.getByRole('textbox', { name: 'Label', exact: true }).fill('Duplicate');
    await page.getByRole('textbox', { name: 'URL', exact: true }).fill('https://example.com/');
    await page.getByRole('button', { name: 'Add to menu', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('already in');
    await page.getByRole('textbox', { name: 'URL', exact: true }).fill('javascript:alert(1)');
    await page.getByRole('button', { name: 'Add to menu', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('HTTP(S)');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add item', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Add item', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Add item', exact: true })).toBeFocused();
    const rows = page.getByRole('list', { name: 'Menu items' }).getByRole('listitem');
    await rows.nth(2).getByRole('button', { name: 'Move up', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Item 2 label' })).toHaveValue('Two');
    await expect(page.getByRole('status')).toContainText('Moved Two to position 2');
    await expect(rows.nth(1).getByRole('button', { name: 'Move up', exact: true })).toBeFocused();
    await rows.nth(1).getByRole('button', { name: 'Move up', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Item 1 label' })).toBeFocused();
    await rows.nth(0).getByRole('button', { name: 'Move down', exact: true }).click();
    await rows.nth(0).getByRole('button', { name: 'Move down', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Item 1 label' })).toHaveValue('Two');
    if (testInfo.project.name === 'desktop') {
      await rows.nth(0).dragTo(rows.nth(2));
      await expect(page.getByRole('textbox', { name: 'Item 3 label' })).toHaveValue('Two');
    }
    await rows.nth(1).getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(rows).toHaveCount(2);
    await expect(page.getByRole('textbox', { name: 'Item 2 label' })).toBeFocused();
    await page.getByRole('button', { name: 'Save menu', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Menu saved.');
    await page.reload();
    await expect(rows).toHaveCount(2);
    await expect(page.getByRole('textbox', { name: 'Item 1 label' })).toHaveValue(testInfo.project.name === 'desktop' ? 'Home' : 'Two');
    await page.getByRole('tab', { name: 'Footer', exact: true }).click();
    await expect(page.getByText('No items in this menu.')).toBeVisible();
  } finally {
    await cleanup(owner);
  }
});

test('navigation manager tabs support keyboard selection and layouts fit all required widths with reduced motion', async ({ page }) => {
  const owner = await createOwner('navigation-ui-responsive');
  try {
    await signInAdmin(page, owner);
    await page.goto('/admin/navigation');
    await expect(page.getByRole('heading', { name: 'Navigation', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'MenuBar', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Footer', exact: true })).toBeFocused();
    await expect(page.getByRole('tab', { name: 'Footer', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(page.getByRole('tab', { name: 'MenuBar', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'ไทย', exact: true }).focus();
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: 'English', exact: true })).toHaveAttribute('aria-selected', 'true');
    await addNavigationItem(page, 'Custom URL', 'A very long navigation label '.repeat(2), undefined, `/${'segment'.repeat(50)}`);
    const addButton = page.getByRole('button', { name: 'Add item', exact: true });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect(await addButton.evaluate((element) => getComputedStyle(element).transitionProperty)).not.toBe('none');
    expect(await addButton.evaluate((element) => getComputedStyle(element).transitionDuration.split(',').some((duration) => parseFloat(duration) > 0))).toBe(true);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const width of [320, 375, 414, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `width ${width}`).toBe(true);
      const row = page.getByRole('list', { name: 'Menu items' }).getByRole('listitem');
      await expect(row.getByRole('button', { name: 'Move up', exact: true })).toBeVisible();
      await expect(row.getByRole('button', { name: 'Move down', exact: true })).toBeVisible();
      expect(await addButton.evaluate((element) => getComputedStyle(element).transitionProperty)).toBe('none');
      expect(await addButton.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe('0s');
      await page.getByRole('button', { name: 'Add item', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Add navigation item' })).toBeVisible();
      expect(await page.getByRole('dialog', { name: 'Add navigation item' }).evaluate((element) => element.scrollWidth <= element.clientWidth), `dialog width ${width}`).toBe(true);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
  } finally {
    await cleanup(owner);
  }
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
        custom(`https://example.com/${'segment/../'.repeat(200)}short`),
      ]),
    });
    expect(response.status()).toBe(200);
    expect((await response.json()).items.map((item: NavigationItem) => item.url)).toEqual([
      'https://example.com/b?x=1#part', 'http://example.com/', '/th/about?x=1#part', '/' + 'a'.repeat(2047),
      'https://example.com/short',
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

test('navigation maps provider authentication rejection to 401 for GET and PUT while unexpected failures stay 500', async ({ page }, testInfo) => {
  const owner = await createOwner('navigation-auth-error');
  const { createServer } = await import('vite');
  const vite = await createServer({
    configFile: false, envPrefix: 'PUBLIC_', appType: 'custom', cacheDir: testInfo.outputPath('vite-cache'),
    server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
  });
  const originalFetch = globalThis.fetch;
  try {
    await signInAdmin(page, owner);
    const { GET, PUT } = await vite.ssrLoadModule('/src/pages/api/navigation/index.ts') as { GET: APIRoute; PUT: APIRoute };
    const cookie = (await page.context().cookies()).map(({ name, value }) => `${name}=${value}`).join('; ');
    for (const status of [401, 403, 500]) {
      globalThis.fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.pathname === '/auth/v1/user') {
          return Response.json({
            error_code: status === 500 ? 'unexpected_failure' : 'bad_jwt',
            message: `Private authentication failure ${owner.id}`,
          }, { status });
        }
        return originalFetch(input, init);
      };
      for (const [method, handler] of [['GET', GET], ['PUT', PUT]] as const) {
        const response = await handler(createContext({
          request: new Request(new URL('/api/navigation', page.url()), {
            method, headers: { cookie, 'content-type': 'application/json' },
            ...(method === 'PUT' ? { body: JSON.stringify(menu([])) } : {}),
          }), defaultLocale: 'en', locals: {},
        }));
        expect(response.status, `${method}, provider status ${status}`).toBe(status === 500 ? 500 : 401);
        expect(await response.json()).toEqual({
          error: status === 500 ? 'Navigation could not be loaded or saved.' : 'Authentication required.',
        });
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    await vite.close();
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
    let releaseRead!: () => void;
    let readReady!: () => void;
    const heldRead = new Promise<void>((resolve) => { releaseRead = resolve; });
    const readStarted = new Promise<void>((resolve) => { readReady = resolve; });
    let deferNextRead = true;
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const read = await originalFetch(input, init);
      if (deferNextRead && url.pathname === '/rest/v1/navigation_items') {
        deferNextRead = false;
        readReady();
        await heldRead;
      }
      return read;
    };
    const oldRead = getPublicNavigation('th');
    try {
      await readStarted;
      const replacement = await PUT(createContext({
        request: new Request(new URL('/api/navigation', page.url()), {
          method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(menu([home('Newest')])),
        }), defaultLocale: 'en', locals: {},
      }));
      expect(replacement.status).toBe(200);
    } finally {
      releaseRead();
    }
    expect((await oldRead).header).toEqual([{ href: '/th', label: 'Updated', kind: 'home' }]);
    expect((await getPublicNavigation('th')).header).toEqual([{ href: '/th', label: 'Newest', kind: 'home' }]);

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
