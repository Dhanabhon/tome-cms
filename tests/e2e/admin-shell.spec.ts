import { expect, test } from '@playwright/test';

import { createOwner, deleteOwner, leaseSiteOwner, signInAdmin } from './support';

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
