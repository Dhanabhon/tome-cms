import { expect, test, type BrowserContext } from '@playwright/test';

import { admin, createOwner, deleteOwner, leaseSiteOwner, signInAdmin } from './support';

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
        timezone: 'UTC',
      },
    });
    expect(savedSettings.status()).toBe(200);
    expect((await savedSettings.json()).settings).toMatchObject({
      default_locale: newLocale,
      site_description: 'A multilingual publication.',
      site_name: 'Tome CMS',
      timezone: 'UTC',
    });

    const ownerInjection = await page.request.put('/api/settings', {
      data: {
        defaultLocale: newLocale,
        owner_id: foreignOwner.id,
        siteDescription: 'A multilingual publication.',
        siteName: 'Tome CMS',
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
