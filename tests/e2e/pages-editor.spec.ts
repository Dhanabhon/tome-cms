import { expect, test } from '@playwright/test';

import { admin, cleanupEditor, createOwner, signInAdmin } from './support';

for (const destination of ['new', 'translation-new', 'edit']) {
  test(`Page login returns to the exact ${destination} editor URL`, async ({ page }) => {
    const owner = await createOwner('page-login');
    const id = crypto.randomUUID();
    try {
      const { error } = await admin.from('pages').insert({
        id, author_id: owner.id, locale: 'th', title: 'Page bookmark', slug: `bookmark-${id}`,
        content_json: { type: 'doc', content: [] }, content_html: '', status: 'draft',
      });
      expect(error).toBeNull();
      const path = destination === 'edit' ? `/admin/pages/edit/${id}`
        : destination === 'translation-new' ? `/admin/pages/new?sourcePageId=${id}&locale=en` : '/admin/pages/new';
      await page.goto(path);
      await expect(page).toHaveURL(new URL(`/admin?returnTo=${encodeURIComponent(path)}`, page.url()).href);
      await page.getByLabel('Email address').fill(owner.email);
      await page.getByLabel('Password').fill(owner.password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page).toHaveURL(new URL(path, page.url()).href);
      await expect(page.getByLabel('Page title')).toHaveValue(destination === 'edit' ? 'Page bookmark' : '');
      await expect(page.getByRole('main')).toHaveCount(1);
      const html = await (await page.request.get(path)).text();
      expect(html.match(/<main(?:\s|>)/g)).toHaveLength(1);
      expect(html).toContain('Loading editor…');
      expect(html).toContain('client="only"');
      expect(html).not.toContain('translation_group_id');
    } finally {
      await cleanupEditor(page, owner);
    }
  });
}

test('Page autosave serializes changes, replaces history, and saves before creating only the missing edition', async ({ page }) => {
  const owner = await createOwner('page-save-race');
  let releaseSave = () => {};
  const gate = new Promise<void>((resolve) => { releaseSave = resolve; });
  try {
    await signInAdmin(page, owner);
    await page.goto('/admin/pages/new');
    let first = true;
    let inFlight = 0;
    let maximumInFlight = 0;
    let creates = 0;
    await page.route('**/api/pages', async (route) => {
      if (!['POST', 'PUT'].includes(route.request().method())) return route.continue();
      if (route.request().method() === 'POST') creates += 1;
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      if (first) { first = false; await gate; }
      const response = await route.fetch();
      inFlight -= 1;
      await route.fulfill({ response });
    });
    await page.getByLabel('Page title').fill('First page title');
    await page.locator('.ProseMirror').fill('First body');
    await expect(page.getByText('Saving…', { exact: true })).toBeVisible();
    const latestTitle = `Newest page ${crypto.randomUUID()}`;
    await page.getByLabel('Page title').fill(latestTitle);
    await page.locator('.ProseMirror').fill('Newest body');
    releaseSave();
    await expect(page).toHaveURL(/\/admin\/pages\/edit\/[0-9a-f-]+$/);
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    const id = page.url().split('/').at(-1)!;
    const { data: source } = await owner.client.from('pages').select('*').eq('id', id).single();
    expect(source).toMatchObject({ title: latestTitle, content_html: '<p>Newest body</p>' });
    expect(creates).toBe(1);
    expect(maximumInFlight).toBe(1);
    const target = source.locale === 'th' ? 'en' : 'th';
    await page.locator('.ProseMirror').fill('Saved before language switch');
    await page.getByRole('button', { name: `Add ${target.toUpperCase()} translation` }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/pages/new\\?sourcePageId=${id}&locale=${target}$`));
    await expect(page.getByLabel('Page title')).toHaveValue('');
    await expect(page.locator('.ProseMirror')).toHaveText('');
    const { data: beforeTranslation } = await owner.client.from('pages').select('*').eq('translation_group_id', source.translation_group_id);
    expect(beforeTranslation).toHaveLength(1);
    expect(beforeTranslation?.[0].content_html).toBe('<p>Saved before language switch</p>');
    const creation = page.waitForRequest((request) => request.url().endsWith('/api/pages') && request.method() === 'POST');
    await page.getByLabel('Page title').fill('Manual Page translation');
    await page.locator('.ProseMirror').fill('Translated body');
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    expect((await creation).postDataJSON()).toMatchObject({ locale: target, sourcePageId: id });
    await expect(page.getByText(`${target.toUpperCase()} published`, { exact: true })).toBeVisible();
    await page.locator('.ProseMirror').fill('Newest translated body');
    await page.getByRole('button', { name: `Edit ${source.locale.toUpperCase()} translation` }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/pages/edit/${id}$`));
    const { data: editions } = await owner.client.from('pages').select('*').eq('translation_group_id', source.translation_group_id);
    expect(editions).toHaveLength(2);
    expect(editions?.find((edition) => edition.locale === target)).toMatchObject({ status: 'published', content_html: '<p>Newest translated body</p>' });
    expect(editions?.find((edition) => edition.id === id)?.status).toBe('draft');
    expect((await page.request.get(`/admin/pages/new?sourcePageId=${id}&locale=${target}`)).status()).toBe(404);
    expect((await page.request.get('/admin/pages/new?locale=en')).status()).toBe(404);
  } finally {
    releaseSave();
    await cleanupEditor(page, owner);
  }
});

test('Page autosave bounds generated slugs for long valid titles', async ({ page }) => {
  const owner = await createOwner('page-long-title');
  const expectedSlug = `${crypto.randomUUID()}-${'a'.repeat(122)}`;
  const title = `${expectedSlug} ${'b'.repeat(40)}`;
  try {
    await signInAdmin(page, owner);
    await page.goto('/admin/pages/new');
    const savedResponse = page.waitForResponse((response) => response.url().endsWith('/api/pages') && response.request().method() === 'POST');
    await page.getByLabel('Page title').fill(title);
    await page.locator('.ProseMirror').fill('A Page with a full-length title.');
    expect((await savedResponse).status()).toBe(201);
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/pages\/edit\/[0-9a-f-]+$/);
    const { data: stored, error } = await owner.client.from('pages').select('title, slug').eq('id', page.url().split('/').at(-1)!).single();
    expect(error).toBeNull();
    expect(stored).toEqual({ title, slug: expectedSlug });
    expect(stored?.slug.length).toBeLessThanOrEqual(160);
    expect(stored?.slug).not.toMatch(/-$/);
  } finally {
    await cleanupEditor(page, owner);
  }
});

test('Page Preview opens immediately, flushes the newest draft, and scopes sanitized content to its owner', async ({ page, browser, playwright }) => {
  const owner = await createOwner('page-preview');
  const foreignOwner = await createOwner('page-preview-foreign');
  const anonymous = await playwright.request.newContext();
  const foreignContext = await browser.newContext();
  let releaseSave = () => {};
  const gate = new Promise<void>((resolve) => { releaseSave = resolve; });
  try {
    await signInAdmin(page, owner);
    await page.goto('/admin/pages/new');
    const button = page.getByRole('button', { name: 'Preview', exact: true });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAccessibleDescription('Add a title before opening Preview.');
    await page.route('**/api/pages', async (route) => { await gate; await route.continue(); });
    await page.getByLabel('Page title').fill('Page preview title');
    await page.locator('.ProseMirror').fill('Newest unsaved Page body');
    const popupPromise = page.waitForEvent('popup');
    await button.click();
    const popup = await popupPromise;
    await expect(popup.getByText('Preparing draft preview…')).toBeVisible();
    releaseSave();
    await expect(popup).toHaveURL(/\/admin\/pages\/preview\/[0-9a-f-]+$/);
    await expect(popup.getByRole('heading', { name: 'Page preview title', exact: true })).toBeVisible();
    await expect(popup.getByText('Newest unsaved Page body')).toBeVisible();
    await expect(popup.getByText('Draft preview', { exact: true })).toBeVisible();
    await expect(popup.locator('h1')).toHaveCount(1);
    await expect(popup.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    await expect(popup.locator('link[rel="canonical"], time')).toHaveCount(0);
    const id = popup.url().split('/').at(-1)!;
    await expect(popup.getByRole('link', { name: 'Edit page' })).toHaveAttribute('href', `/admin/pages/edit/${id}`);
    const response = await page.request.get(popup.url());
    expect(response.headers()['cache-control']).toBe('private, no-store');
    expect((await anonymous.get(popup.url())).status()).toBe(401);
    for (const missing of ['not-a-uuid', crypto.randomUUID()]) {
      expect((await page.request.get(`/admin/pages/preview/${missing}`)).status()).toBe(404);
    }
    const foreignPage = await foreignContext.newPage();
    await signInAdmin(foreignPage, foreignOwner);
    expect((await foreignPage.request.get(popup.url())).status()).toBe(404);
    expect((await foreignPage.request.get(`/admin/pages/edit/${id}`)).status()).toBe(404);
    expect((await foreignPage.request.get(`/admin/pages/new?sourcePageId=${id}&locale=en`)).status()).toBe(404);
    await admin.from('pages').update({ content_html: '<h1>Body heading</h1><p>Safe body</p><script>alert(1)</script>' }).eq('id', id);
    await popup.reload();
    await expect(popup.getByText('Safe body')).toBeVisible();
    await expect(popup.locator('h1')).toHaveCount(1);
    expect(await popup.locator('article').innerHTML()).not.toContain('<script>');
    await popup.close();
  } finally {
    releaseSave();
    await anonymous.dispose();
    await foreignContext.close();
    await cleanupEditor(page, owner, foreignOwner);
  }
});

test('Page publish requires content and Settings expose only slug and search metadata at every supported width', async ({ page }) => {
  const owner = await createOwner('page-settings');
  try {
    await signInAdmin(page, owner);
    await page.goto('/admin/pages/new');
    await expect(page.getByLabel('Page title')).toHaveAttribute('placeholder', 'Untitled page');
    await expect(page.getByRole('link', { name: 'Back to Pages' })).toHaveAttribute('href', '/admin/pages');
    await page.getByLabel('Page title').fill('Page settings test');
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Add content before publishing.');
    await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeVisible();
    await page.locator('.ProseMirror').fill('Publishable Page content');
    const settings = page.getByRole('button', { name: 'Settings', exact: true });
    await settings.click();
    const drawer = page.getByRole('dialog', { name: 'Page settings' });
    const slug = `page-settings-${crypto.randomUUID()}`;
    await drawer.getByLabel('Slug').fill(slug);
    await drawer.getByLabel('Meta title').fill('Page search title');
    await drawer.getByLabel('Meta description').fill('Page search summary');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Update', exact: true })).toBeVisible();
    const { data: stored } = await owner.client.from('pages').select('*').eq('slug', slug).single();
    expect(stored).toMatchObject({ meta_title: 'Page search title', meta_description: 'Page search summary', status: 'published' });
    for (const width of [320, 375, 414, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const control of await page.locator('.admin-editor-bar button, .admin-editor-bar a').all()) {
        await expect(control).toBeInViewport();
        const bounds = await control.boundingBox();
        expect(bounds?.width).toBeGreaterThanOrEqual(44);
        expect(bounds?.height).toBeGreaterThanOrEqual(44);
      }
      await settings.click();
      await expect(drawer.getByRole('button', { name: 'Close settings' })).toBeFocused();
      await expect(drawer.locator('input, textarea')).toHaveCount(3);
      await expect(page.getByText(/Cover image|reading time|author/i)).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const control of await drawer.locator('input, textarea, button').all()) {
        const bounds = await control.boundingBox();
        expect(bounds?.width).toBeGreaterThanOrEqual(44);
        expect(bounds?.height).toBeGreaterThanOrEqual(44);
      }
      if (width <= 414) expect((await drawer.boundingBox())?.width).toBe(width);
      await page.keyboard.press('Escape');
      await expect(settings).toBeFocused();
    }
  } finally {
    await cleanupEditor(page, owner);
  }
});
