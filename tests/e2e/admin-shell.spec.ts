import { expect, test } from '@playwright/test';

import { admin, createOwner, deleteOwner, leaseSiteOwner, signInAdmin } from './support';

test('shared database suite defaults to one worker', async () => {
  const { default: config } = await import('../../playwright.config');
  expect(config.workers).toBe(1);
});

test('Admin navigation, mobile focus, and sign out', async ({ page }, testInfo) => {
  const owner = await createOwner('admin-shell');
  const restore = await leaseSiteOwner(owner);
  try {
    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    await expect(page.getByRole('main')).toHaveCount(1);
    const mobile = testInfo.project.name === 'mobile';
    const opener = page.getByRole('button', { name: 'Open navigation' });
    const dialog = page.getByRole('dialog', { name: 'Admin navigation' });
    if (mobile) {
      await opener.click();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Close navigation' })).toBeFocused();
      await page.locator('.admin-shell-main a[href="/admin/new"]').first().evaluate((element) => (element as HTMLElement).focus());
      await expect(dialog.getByRole('button', { name: 'Close navigation' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      await expect(opener).toBeFocused();
      await opener.click();
    } else {
      await expect(opener).not.toBeVisible();
    }
    const navigation = mobile ? dialog.getByRole('navigation') : page.locator('.admin-sidebar').getByRole('navigation');
    await expect(navigation.getByRole('link')).toHaveText(['Posts', 'Media', 'Profile', 'Settings']);
    await expect(navigation.getByRole('link', { name: 'Posts', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: 'Stats', exact: true })).toHaveCount(0);
    await navigation.getByRole('link', { name: 'Profile', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible();
    await expect(page.getByRole('main')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (mobile) await opener.click();
    await expect(navigation.getByRole('link', { name: 'Profile', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Admin', exact: true })).toHaveCount(0);
  } finally {
    await restore();
    await deleteOwner(owner);
  }
});

test('protected Admin routes return to the requested page after sign in', async ({ page }) => {
  const owner = await createOwner('admin-return');
  const restore = await leaseSiteOwner(owner);
  try {
    await page.goto('/admin/profile');
    await expect(page).toHaveURL(/\/admin\?returnTo=%2Fadmin%2Fprofile$/);
    await page.getByLabel('Email address').fill(owner.email);
    await page.getByLabel('Password').fill(owner.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/admin\/profile$/);
  } finally {
    await restore();
    await deleteOwner(owner);
  }
});

test('return path validation rejects unsafe destinations', async () => {
  const { safeAdminReturnTo, adminLoginPath } = await import('../../src/lib/admin');
  for (const unsafe of [null, undefined, '', '/administrator', '//evil.example/admin', '//admin.invalid/admin/profile', 'https://evil.example/admin', 'https://admin.invalid/admin/profile', '/admin/../../outside', '/\\evil.example/admin']) {
    expect(safeAdminReturnTo(unsafe)).toBe('/admin');
  }
  expect(safeAdminReturnTo('/admin?filter=draft')).toBe('/admin?filter=draft');
  expect(safeAdminReturnTo('/admin/profile?tab=links#avatar')).toBe('/admin/profile?tab=links');
  expect(adminLoginPath('/admin')).toBe('/admin');
  expect(adminLoginPath('/admin/settings?tab=site')).toBe('/admin?returnTo=%2Fadmin%2Fsettings%3Ftab%3Dsite');
});

for (const [bookmark, destination] of [
  ['/admin?status=published&locale=en&q=story', '/admin?status=published&locale=en&q=story'],
  ['/admin?status=published&returnTo=%2Fadmin%2Fmedia', '/admin/media'],
  ['/admin?status=published&returnTo=https%3A%2F%2Fevil.example%2Fadmin', '/admin'],
  ['/admin?status=published&returnTo=', '/admin'],
]) {
  test(`filtered login bookmark respects return destination: ${bookmark}`, async ({ page }) => {
    const owner = await createOwner('filtered-login');
    try {
      await page.goto(bookmark);
      await page.getByLabel('Email address').fill(owner.email);
      await page.getByLabel('Password').fill(owner.password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page.locator('.admin-shell')).toBeVisible();
      await expect(page).toHaveURL(new URL(destination, page.url()).href);
      if (destination.includes('locale=en')) {
        await expect(page.getByRole('tab', { name: 'Published' })).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByLabel('Language', { exact: true })).toHaveValue('en');
        await expect(page.getByLabel('Search posts')).toHaveValue('story');
      }
    } finally {
      await deleteOwner(owner);
    }
  });
}

test('editor routes retain one main in loading, authenticated, and error states', async ({ page }) => {
  const owner = await createOwner('editor-landmarks');
  const restore = await leaseSiteOwner(owner);
  const postId = crypto.randomUUID();
  try {
    for (const path of ['/admin/new', `/admin/edit/${postId}`, '/admin/edit/invalid']) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(path.endsWith('invalid') ? 404 : 401);
      await expect.soft(page.getByRole('main')).toHaveCount(1, { timeout: 1_000 });
      await expect(page.getByRole('alert')).toBeVisible();
    }
    const { error } = await admin.from('posts').insert({
      id: postId, author_id: owner.id, title: 'Landmark draft', locale: 'en',
      slug: `landmark-${postId}`, status: 'draft', content_json: { type: 'doc', content: [] }, content_html: '',
    });
    expect(error).toBeNull();
    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    for (const path of ['/admin', '/admin/media', '/admin/profile', '/admin/settings']) {
      await page.goto(path);
      await expect(page.getByRole('main')).toHaveCount(1);
    }
    for (const path of ['/admin/new', `/admin/edit/${postId}`]) {
      const response = await page.request.get(path);
      const html = await response.text();
      expect.soft(html.match(/<main(?:\s|>)/g) ?? []).toHaveLength(1);
      expect(html.includes('Loading editor…')).toBe(true);
      await page.goto(path);
      await expect(page.getByLabel('Post title')).toBeVisible();
      await expect.soft(page.getByRole('main')).toHaveCount(1, { timeout: 1_000 });
      await expect(page.locator('.admin-shell')).toHaveCount(0);
    }
    const missing = await page.goto(`/admin/edit/${crypto.randomUUID()}`);
    expect(missing?.status()).toBe(404);
    await expect.soft(page.getByRole('main')).toHaveCount(1, { timeout: 1_000 });
    await expect(page.getByRole('alert')).toHaveText('Post not found.');
  } finally {
    await admin.from('posts').delete().eq('id', postId);
    await restore();
    await deleteOwner(owner);
  }
});

test('mobile navigation is a side drawer across supported widths and reduced motion', async ({ page }) => {
  const owner = await createOwner('side-drawer');
  try {
    await signInAdmin(page, owner);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const width of [320, 375, 414, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      const opener = page.getByRole('button', { name: 'Open navigation' });
      if (width >= 1024) {
        await expect(opener).not.toBeVisible();
        await expect(page.locator('.admin-sidebar')).toBeVisible();
        continue;
      }
      await opener.click();
      const dialog = page.getByRole('dialog', { name: 'Admin navigation' });
      const bounds = await dialog.boundingBox();
      expect.soft(bounds?.x).toBe(0);
      expect.soft(bounds?.y).toBe(0);
      expect.soft(bounds?.height).toBe(800);
      expect(bounds!.width).toBeLessThan(width);
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      for (const control of await dialog.locator('button, nav a, .admin-shell-account > a').all()) {
        const target = await control.boundingBox();
        expect(target?.width).toBeGreaterThanOrEqual(44);
        expect(target?.height).toBeGreaterThanOrEqual(44);
      }
      expect(await dialog.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe('0s');
      await expect(dialog.getByRole('button', { name: 'Close navigation' })).toBeFocused();
      await page.keyboard.press('Tab');
      // WebKit may tab to browser chrome; focus must never enter the inert page behind the modal.
      expect(await dialog.evaluate((element) => !document.hasFocus() || element.contains(document.activeElement))).toBe(true);
      await page.keyboard.press('Shift+Tab');
      expect(await dialog.evaluate((element) => !document.hasFocus() || element.contains(document.activeElement))).toBe(true);
      await dialog.getByRole('button', { name: 'Close navigation' }).focus();
      await expect(dialog.getByRole('button', { name: 'Close navigation' })).toBeFocused();
      await page.locator('.admin-shell-main a[href="/admin/new"]').first().evaluate((element) => (element as HTMLElement).focus());
      await expect(dialog.getByRole('button', { name: 'Close navigation' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      await expect(opener).toBeFocused();
      await opener.click();
      await dialog.getByRole('button', { name: 'Close navigation' }).click();
      await expect(opener).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  } finally {
    await deleteOwner(owner);
  }
});
