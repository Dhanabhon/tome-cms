import { expect, test, type BrowserContext } from '@playwright/test';

import { admin, chooseUiOption, createOwner, deleteOwner, leaseSiteOwner, signInAdmin } from './support';

for (const surface of ['profile', 'settings']) {
  test(`${surface} associates server field errors and preserves whitespace-only required values`, async ({ page }) => {
    const owner = await createOwner(`field-errors-${surface}`);
    const restore = await leaseSiteOwner(owner);
    try {
      await signInAdmin(page, owner);
      await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
      await page.goto(`/admin/${surface}`);
      if (surface === 'profile') {
        while (await page.getByRole('button', { name: /Remove link/ }).count()) {
          await page.getByRole('button', { name: /Remove link/ }).first().click();
        }
        await page.getByRole('button', { name: 'Add link' }).click();
        await page.getByLabel('Link 1 URL').fill('https://example.com');
      }
      const field = page.getByRole('textbox', { name: surface === 'profile' ? 'Link 1 label' : 'Site name', exact: true });
      await field.fill('   ');
      const response = page.waitForResponse((result) => result.url().endsWith(`/api/${surface}`) && result.request().method() === 'PUT');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      const rejected = await response;
      expect(rejected.status()).toBe(400);
      const payload = await rejected.json();
      const message = surface === 'profile'
        ? payload.issues.properties.authorLinks.items[0].properties.label.errors[0]
        : payload.issues.properties.siteName.errors[0];
      await expect(field).toHaveValue('   ');
      await expect(field).toHaveAttribute('aria-invalid', 'true');
      await expect(field).toHaveAccessibleDescription(message);
      const errorId = await field.getAttribute('aria-describedby');
      await expect(page.locator(`[id="${errorId}"]`)).toBeVisible();
      await expect(page.locator(`[id="${errorId}"]`)).toHaveAttribute('aria-live', 'polite');
      await expect(page.getByRole('status')).toBeEmpty();
      await field.fill('Corrected value');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByRole('status')).toHaveText('Saved.');
      await expect(field).not.toHaveAttribute('aria-invalid', 'true');
      await expect(page.locator(`[id="${errorId}"]`)).toBeEmpty();
    } finally {
      await restore();
      await deleteOwner(owner);
    }
  });
}

test('Profile and Settings forms save, persist, and retain edits on failure', async ({ page }) => {
  const owner = await createOwner('configuration-forms');
  const restore = await leaseSiteOwner(owner);
  try {
    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    await page.goto('/admin/profile');
    await page.getByLabel('Author name').fill('Profile Owner');
    await page.getByLabel('Bio (English)').fill('English profile');
    await page.getByLabel('Bio (Thai)').fill('ประวัติภาษาไทย');
    while (await page.getByRole('button', { name: /Remove link/ }).count()) {
      await page.getByRole('button', { name: /Remove link/ }).first().click();
    }
    await page.getByRole('button', { name: 'Add link' }).click();
    await page.getByLabel('Link 1 label').fill('Website');
    await page.getByLabel('Link 1 URL').fill('https://example.com/profile');
    for (let index = 2; index <= 5; index++) await page.getByRole('button', { name: 'Add link' }).click();
    await expect(page.getByRole('button', { name: 'Add link' })).toBeDisabled();
    for (let index = 5; index >= 2; index--) await page.getByRole('button', { name: `Remove link ${index}` }).click();
    await page.getByRole('button', { name: 'Choose avatar' }).click();
    await expect(page.getByRole('dialog', { name: 'Media library', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Choose avatar' })).toBeFocused();
    await page.getByRole('button', { name: 'Choose avatar' }).click();
    await page.getByLabel('Upload image').setInputFiles({
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4WQAAAAASUVORK5CYII=', 'base64'),
      mimeType: 'image/png',
      name: 'author-avatar.png',
    });
    await expect(page.getByRole('img', { name: 'Author avatar' })).toBeVisible();
    await page.getByRole('button', { name: 'Choose avatar' }).click();
    await page.getByRole('button', { name: /Select author-avatar\.png/ }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Saved.');
    await page.reload();
    await expect(page.getByLabel('Author name')).toHaveValue('Profile Owner');
    await expect(page.getByLabel('Bio (English)')).toHaveValue('English profile');
    await expect(page.getByLabel('Bio (Thai)')).toHaveValue('ประวัติภาษาไทย');
    await expect(page.getByLabel('Link 1 URL')).toHaveValue('https://example.com/profile');
    await expect(page.getByRole('img', { name: 'Author avatar' })).toHaveAttribute('src', new RegExp(`/storage/v1/object/public/blog-media/${owner.id}/`));
    await page.getByRole('button', { name: 'Remove avatar' }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Saved.');
    await page.reload();
    await expect(page.getByRole('img', { name: 'Author avatar' })).toHaveCount(0);
    await page.route('**/api/profile', (route) => route.fulfill({ status: 500, json: { error: 'Profile save failed.' } }));
    await page.getByLabel('Author name').fill('Unsaved profile');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Profile save failed.');
    await expect(page.getByLabel('Author name')).toHaveValue('Unsaved profile');
    await expect(page.getByRole('status')).toBeEmpty();

    await page.goto('/admin/settings');
    await page.getByLabel('Site name', { exact: true }).fill('My publication');
    await page.getByLabel('Tagline').fill('Ideas worth keeping.');
    await page.getByLabel('Site description').fill('A multilingual publication.');
    await chooseUiOption(page, 'Default language', 'English');
    await chooseUiOption(page, 'Timezone', 'UTC');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Saved.');
    await page.reload();
    await expect(page.getByLabel('Site name', { exact: true })).toHaveValue('My publication');
    await expect(page.getByLabel('Tagline')).toHaveValue('Ideas worth keeping.');
    await expect(page.getByLabel('Site description')).toHaveValue('A multilingual publication.');
    await expect(page.getByRole('combobox', { name: 'Default language' })).toHaveAttribute('data-value', 'en');
    await expect(page.getByRole('combobox', { name: 'Timezone' })).toHaveAttribute('data-value', 'UTC');
    await page.goto('/en');
    await expect(page.getByText('Ideas worth keeping.', { exact: true })).toBeVisible();
    await expect(page.getByText('A multilingual publication.', { exact: true })).toHaveCount(0);
    await page.goto('/admin/settings');
    let submissions = 0;
    await page.route('**/api/settings', async (route) => {
      submissions++;
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({ status: 500, json: { error: 'Settings save failed.' } });
    });
    await page.getByLabel('Site name', { exact: true }).fill('Unsaved site');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    await expect(page.getByRole('alert')).toHaveText('Settings save failed.');
    await expect(page.getByLabel('Site name', { exact: true })).toHaveValue('Unsaved site');
    await expect(page.getByRole('status')).toBeEmpty();
    expect(submissions).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await restore();
    await deleteOwner(owner);
  }
});

test('only the configured owner can update strict Profile and Settings fields', async ({ browser, page }) => {
  const owner = await createOwner('site-owner');
  const foreignOwner = await createOwner('site-non-owner');
  const postId = crypto.randomUUID();
  const foreignMediaId = crypto.randomUUID();
  let anonymousContext: BrowserContext | undefined;
  let foreignContext: BrowserContext | undefined;
  let restoreOwner: (() => Promise<void>) | undefined;

  try {
    restoreOwner = await leaseSiteOwner(owner);

    anonymousContext = await browser.newContext();
    const anonymousRequest = anonymousContext.request;
    const anonymousProfile = await anonymousRequest.put('/api/profile', {
      data: {
        authorAvatarMediaId: null,
        authorBioEn: '',
        authorBioTh: '',
        authorLinks: [],
        authorName: 'Anonymous',
      },
    });
    expect(anonymousProfile.status()).toBe(401);
    const anonymousSettings = await anonymousRequest.put('/api/settings', {
      data: {
        defaultLocale: 'th',
        siteDescription: '',
        siteName: 'Anonymous',
        timezone: 'Asia/Bangkok',
      },
    });
    expect(anonymousSettings.status()).toBe(401);

    foreignContext = await browser.newContext();
    const foreignPage = await foreignContext.newPage();
    await signInAdmin(foreignPage, foreignOwner);
    await expect(foreignPage.getByRole('link', { name: 'New post' })).toBeVisible();
    for (const path of ['/admin/profile', '/admin/settings']) {
      const forbidden = await foreignPage.request.get(path);
      expect(forbidden.status()).toBe(404);
      expect(await forbidden.text()).not.toContain('class="admin-shell"');
    }
    const foreignProfile = await foreignPage.request.put('/api/profile', {
      data: {
        authorAvatarMediaId: null,
        authorBioEn: '',
        authorBioTh: '',
        authorLinks: [],
        authorName: 'Foreign owner',
      },
    });
    expect(foreignProfile.status()).toBe(404);
    const foreignSettings = await foreignPage.request.put('/api/settings', {
      data: {
        defaultLocale: 'th',
        siteDescription: '',
        siteName: 'Foreign owner',
        timezone: 'Asia/Bangkok',
      },
    });
    expect(foreignSettings.status()).toBe(404);

    const { error: mediaError } = await foreignOwner.client.from('media_items').insert({
      alt_text: null,
      folder_id: null,
      height: 1,
      id: foreignMediaId,
      mime_type: 'image/png',
      original_name: 'foreign-avatar.png',
      owner_id: foreignOwner.id,
      size_bytes: 1,
      storage_path: `${foreignOwner.id}/${foreignMediaId}.png`,
      width: 1,
    });
    if (mediaError) throw mediaError;

    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    const browserSettings = await owner.client.from('site_settings').select('*');
    expect(browserSettings.error).toBeNull();
    expect(browserSettings.data).toEqual([]);

    const savedProfile = await page.request.put('/api/profile', {
      data: {
        authorAvatarMediaId: null,
        authorBioEn: 'English bio',
        authorBioTh: 'ประวัติภาษาไทย',
        authorLinks: [{ label: 'Website', url: 'https://example.com/about' }],
        authorName: 'Tome Owner',
      },
    });
    expect(savedProfile.status()).toBe(200);
    expect((await savedProfile.json()).settings).toMatchObject({
      author_avatar_media_id: null,
      author_bio_en: 'English bio',
      author_bio_th: 'ประวัติภาษาไทย',
      author_links: [{ label: 'Website', url: 'https://example.com/about' }],
      author_name: 'Tome Owner',
    });

    const invalidProtocol = await page.request.put('/api/profile', {
      data: {
        authorAvatarMediaId: null,
        authorBioEn: '',
        authorBioTh: '',
        authorLinks: [{ label: 'Unsafe', url: 'javascript:alert(1)' }],
        authorName: 'Tome Owner',
      },
    });
    expect(invalidProtocol.status()).toBe(400);

    const malformedUrl = await page.request.put('/api/profile', {
      data: {
        authorAvatarMediaId: null,
        authorBioEn: '',
        authorBioTh: '',
        authorLinks: [{ label: 'Malformed', url: 'https://' }],
        authorName: 'Tome Owner',
      },
    });
    expect(malformedUrl.status()).toBe(400);

    for (const authorLinks of [
      [{ label: ' ', url: 'https://example.com' }],
      Array.from({ length: 6 }, (_, index) => ({ label: `Link ${index}`, url: `https://example.com/${index}` })),
    ]) {
      const invalidLinks = await page.request.put('/api/profile', {
        data: {
          authorAvatarMediaId: null,
          authorBioEn: '',
          authorBioTh: '',
          authorLinks,
          authorName: 'Tome Owner',
        },
      });
      expect(invalidLinks.status()).toBe(400);
    }

    const foreignAvatar = await page.request.put('/api/profile', {
      data: {
        authorAvatarMediaId: foreignMediaId,
        authorBioEn: '',
        authorBioTh: '',
        authorLinks: [],
        authorName: 'Tome Owner',
      },
    });
    expect(foreignAvatar.status()).toBe(404);

    const profilePayload = {
      authorAvatarMediaId: null, authorBioEn: '', authorBioTh: '', authorLinks: [], authorName: 'Tome Owner',
    };
    const missingAvatar = await page.request.put('/api/profile', {
      data: { ...profilePayload, authorAvatarMediaId: crypto.randomUUID() },
    });
    expect(missingAvatar.status()).toBe(404);
    for (const extra of [
      { owner_id: foreignOwner.id },
      { unexpected: 'extra' },
      { siteName: 'Cross-surface site name' },
      { defaultLocale: 'en', siteDescription: 'Cross-surface description', timezone: 'UTC' },
      { authorLinks: [{ label: 'Website', url: 'https://example.com', extra: true }] },
    ]) {
      const rejectedProfile = await page.request.put('/api/profile', { data: { ...profilePayload, ...extra } });
      expect(rejectedProfile.status()).toBe(400);
    }

    const { data: originalSettings, error: settingsError } = await admin
      .from('site_settings')
      .select('default_locale')
      .eq('id', true)
      .single();
    if (settingsError) throw settingsError;
    const newLocale = originalSettings.default_locale === 'th' ? 'en' : 'th';

    const { error: postError } = await owner.client.from('posts').insert({
      author_id: owner.id,
      content_html: '<p>Locale must remain stable.</p>',
      content_json: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Locale must remain stable.' }] }] },
      id: postId,
      locale: originalSettings.default_locale,
      slug: `settings-${postId}`,
      status: 'draft',
      title: 'Settings locale regression',
    });
    if (postError) throw postError;

    const savedSettings = await page.request.put('/api/settings', {
      data: {
        defaultLocale: newLocale,
        siteDescription: 'A multilingual publication.',
        siteName: 'Tome CMS',
        tagline: 'Ideas in two languages.',
        timezone: 'UTC',
      },
    });
    expect(savedSettings.status()).toBe(200);
    expect((await savedSettings.json()).settings).toMatchObject({
      default_locale: newLocale,
      site_description: 'A multilingual publication.',
      site_name: 'Tome CMS',
      tagline: 'Ideas in two languages.',
      timezone: 'UTC',
    });

    const ownerInjection = await page.request.put('/api/settings', {
      data: {
        defaultLocale: newLocale,
        owner_id: foreignOwner.id,
        siteDescription: 'A multilingual publication.',
        siteName: 'Tome CMS',
        tagline: 'Ideas in two languages.',
        timezone: 'UTC',
      },
    });
    expect(ownerInjection.status()).toBe(400);

    const root = await page.request.get('/', { maxRedirects: 0 });
    expect(root.status()).toBe(302);
    expect(root.headers().location).toBe(`/${newLocale}`);

    const { data: unchangedPost, error: unchangedPostError } = await admin
      .from('posts')
      .select('locale, status')
      .eq('id', postId)
      .single();
    if (unchangedPostError) throw unchangedPostError;
    expect(unchangedPost).toEqual({ locale: originalSettings.default_locale, status: 'draft' });
  } finally {
    await anonymousContext?.close();
    await foreignContext?.close();
    await admin.from('posts').delete().eq('id', postId);
    await admin.from('media_items').delete().eq('id', foreignMediaId);
    if (restoreOwner) await restoreOwner();
    await deleteOwner(owner);
    await deleteOwner(foreignOwner);
  }
});
