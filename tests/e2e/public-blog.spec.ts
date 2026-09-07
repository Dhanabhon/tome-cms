import { expect, test, type BrowserContext } from '@playwright/test';

import { getPublicSiteUrl } from '../../src/lib/seo';
import type { Post } from '../../src/types/cms';
import { admin, createOwner, deleteOwner, leaseSiteOwner, signInAdmin } from './support';

const postBody = (title: string, slug: string, contentHtml: string) => ({
  contentHtml,
  contentJson: {
    content: [
      { attrs: { level: 2 }, content: [{ text: title, type: 'text' }], type: 'heading' },
      { content: [{ text: 'Visible without JavaScript.', type: 'text' }], type: 'paragraph' },
    ],
    type: 'doc',
  },
  metaTitle: `Answer-ready ${title}`,
  slug,
  status: 'published' as const,
  title,
});

test('localized published editions render without public JavaScript', async ({ browser, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The public HTML contract only needs one browser project.');
  expect(
    getPublicSiteUrl(
      new Request('http://127.0.0.1:4321/blog/example', {
        headers: { 'x-forwarded-host': 'blog.example.com', 'x-forwarded-proto': 'https' },
      }),
    ).toString(),
  ).toBe('https://blog.example.com/');
  const owner = await createOwner('public-blog');
  const slug = `public-media-${crypto.randomUUID()}`;
  const expectedDescription = 'Public media regression Visible without JavaScript.';
  const avatarId = crypto.randomUUID();
  const avatarPath = `${owner.id}/${avatarId}.png`;
  let defaultLocale: Post['locale'] | undefined;
  let noScriptContext: BrowserContext | undefined;
  let restoreOwner: (() => Promise<void>) | undefined;

  try {
    restoreOwner = await leaseSiteOwner(owner);
    const { data: settings, error: settingsError } = await admin
      .from('site_settings')
      .select('default_locale, site_name')
      .eq('id', true)
      .single();
    if (settingsError) throw settingsError;
    defaultLocale = settings.default_locale;

    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    const avatar = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4WQAAAAASUVORK5CYII=', 'base64');
    const { error: avatarUploadError } = await owner.client.storage
      .from('blog-media')
      .upload(avatarPath, avatar, { contentType: 'image/png' });
    if (avatarUploadError) throw avatarUploadError;
    const { error: avatarInsertError } = await owner.client.from('media_items').insert({
      alt_text: null,
      folder_id: null,
      height: 1,
      id: avatarId,
      mime_type: 'image/png',
      original_name: 'public-author-avatar.png',
      owner_id: owner.id,
      size_bytes: avatar.byteLength,
      storage_path: avatarPath,
      width: 1,
    });
    if (avatarInsertError) throw avatarInsertError;
    const profileResponse = await page.request.put('/api/profile', {
      data: {
        authorAvatarMediaId: avatarId,
        authorBioEn: 'English bio',
        authorBioTh: 'ประวัติภาษาไทย',
        authorLinks: [{ label: 'Website', url: 'https://example.com/about' }],
        authorName: 'Tome Owner',
      },
    });
    expect(profileResponse.status()).toBe(200);
    const createSourceResponse = await page.request.post('/api/posts', {
      data: {
        ...postBody(
          'Public media regression',
          slug,
          '<h2>Public media regression</h2><script>alert("unsafe")</script><p>Visible without JavaScript.</p>',
        ),
        metaTitle: 'Answer-ready public article',
      },
    });
    expect(createSourceResponse.status()).toBe(201);
    const source = (await createSourceResponse.json()).post as Post;

    const siblingLocale = source.locale === 'th' ? 'en' : 'th';
    const createSiblingResponse = await page.request.post('/api/posts', {
      data: {
        ...postBody('Linked public edition', slug, '<h2>Linked public edition</h2><p>Visible without JavaScript.</p>'),
        locale: siblingLocale,
        sourcePostId: source.id,
      },
    });
    expect(createSiblingResponse.status()).toBe(201);
    const sibling = (await createSiblingResponse.json()).post as Post;

    noScriptContext = await browser.newContext({ javaScriptEnabled: false });
    const publicPage = await noScriptContext.newPage();

    const rootResponse = await publicPage.request.get('/', { maxRedirects: 0 });
    expect(rootResponse.status()).toBe(302);
    await publicPage.goto('/');
    await expect(publicPage).toHaveURL(new RegExp(`/${defaultLocale}/?$`));

    const response = await publicPage.goto(`/${source.locale}/blog/${source.slug}`);
    expect(response?.status()).toBe(200);
    await expect(publicPage.locator('html')).toHaveAttribute('lang', source.locale);
    expect(await publicPage.title()).toContain('Answer-ready public article');
    await expect(publicPage.locator('meta[name="description"]')).toHaveAttribute('content', expectedDescription);
    await expect(publicPage.locator('meta[name="robots"]')).toHaveAttribute('content', /index, follow/);
    await expect(publicPage.locator('meta[property="article:published_time"]')).toHaveAttribute('content', source.published_at!);
    await expect(publicPage.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      new RegExp(`/${source.locale}/blog/${source.slug}$`),
    );
    await expect(publicPage.locator(`link[rel="alternate"][hreflang="${sibling.locale}"]`)).toHaveAttribute(
      'href',
      new RegExp(`/${sibling.locale}/blog/${sibling.slug}$`),
    );
    await expect(publicPage.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute(
      'href',
      new RegExp(`/${source.locale}/blog/${source.slug}$`),
    );
    const languageTrigger = publicPage.getByRole('button', {
      name: `Change language. Current language: ${source.locale === 'en' ? 'English (US)' : 'ไทย'}`,
    });
    await expect(languageTrigger).toBeVisible();
    await languageTrigger.click();
    const languageMenu = publicPage.getByRole('navigation', { name: 'Choose language' });
    await expect(languageMenu).toBeVisible();
    await expect(languageMenu.getByRole('link')).toHaveCount(2);
    await expect(languageMenu.getByRole('link', { name: 'English (US)' })).toBeVisible();
    await expect(languageMenu.getByRole('link', { name: 'ไทย' })).toBeVisible();
    await expect(publicPage.locator(`header a[href="/${sibling.locale}/blog/${sibling.slug}"]`)).toBeVisible();
    await expect(publicPage.locator('header nav[aria-label="Primary"], footer nav[aria-label="Footer"]')).toHaveCount(0);
    await expect(publicPage.locator('header a[href="/admin"], footer a[href="/admin"]')).toHaveCount(0);
    await expect(publicPage.getByRole('heading', { name: 'Public media regression', level: 2 })).toBeVisible();
    await expect(publicPage.getByText('Visible without JavaScript.')).toBeVisible();

    const structuredData = JSON.parse(
      (await publicPage.locator('script[type="application/ld+json"]').textContent()) ?? '{}',
    ) as Record<string, unknown>;
    expect(structuredData).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      author: { '@type': 'Person', name: 'Tome Owner' },
      dateModified: source.updated_at,
      datePublished: source.published_at,
      description: expectedDescription,
      headline: 'Public media regression',
      inLanguage: source.locale,
      publisher: { '@type': 'Organization', name: settings.site_name },
    });
    await expect(publicPage.locator('meta[name="author"]')).toHaveAttribute('content', 'Tome Owner');

    const thai = source.locale === 'th' ? source : sibling;
    const english = source.locale === 'en' ? source : sibling;
    await publicPage.goto(`/th/blog/${thai.slug}`);
    const thaiAuthor = publicPage.getByRole('complementary', { name: 'About the author' });
    await expect(thaiAuthor.getByText('Tome Owner')).toBeVisible();
    await expect(thaiAuthor.getByText('ประวัติภาษาไทย')).toBeVisible();
    await expect(thaiAuthor.getByText('English bio')).toHaveCount(0);
    await expect(thaiAuthor.locator('img')).toHaveAttribute('alt', '');
    await expect(thaiAuthor.locator('img')).toHaveAttribute('src', new RegExp(`/storage/v1/object/public/blog-media/${owner.id}/`));
    await expect(thaiAuthor.getByRole('link', { name: 'Website' })).toHaveAttribute('href', 'https://example.com/about');
    await expect(thaiAuthor.getByRole('link', { name: 'Website' })).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(thaiAuthor.getByRole('link', { name: 'Tome Owner' })).toHaveCount(0);

    await publicPage.goto(`/en/blog/${english.slug}`);
    const englishAuthor = publicPage.getByRole('complementary', { name: 'About the author' });
    await expect(englishAuthor.getByText('Tome Owner')).toBeVisible();
    await expect(englishAuthor.getByText('English bio')).toBeVisible();
    await expect(englishAuthor.getByText('ประวัติภาษาไทย')).toHaveCount(0);

    const clearedProfile = await page.request.put('/api/profile', {
      data: {
        authorAvatarMediaId: avatarId,
        authorBioEn: 'English bio',
        authorBioTh: 'ประวัติภาษาไทย',
        authorLinks: [{ label: 'Website', url: 'https://example.com/about' }],
        authorName: '   ',
      },
    });
    expect(clearedProfile.status()).toBe(200);
    await publicPage.goto(`/th/blog/${thai.slug}`);
    await expect(publicPage.getByRole('complementary', { name: 'About the author' })).toHaveCount(0);
    await expect(publicPage.locator('meta[name="author"]')).toHaveAttribute('content', settings.site_name);
    const clearedStructuredData = JSON.parse(
      (await publicPage.locator('script[type="application/ld+json"]').textContent()) ?? '{}',
    ) as Record<string, unknown>;
    expect(clearedStructuredData).toMatchObject({
      author: { '@type': 'Organization', name: settings.site_name },
      publisher: { '@type': 'Organization', name: settings.site_name },
    });

    const legacy = await publicPage.request.get(`/blog/${source.slug}`, { maxRedirects: 0 });
    expect(legacy.status()).toBe(301);
    expect(legacy.headers().location).toBe(`/${source.locale}/blog/${source.slug}`);

    const sitemapResponse = await publicPage.request.get('/sitemap.xml');
    expect(sitemapResponse.status()).toBe(200);
    expect(sitemapResponse.headers()['content-type']).toContain('application/xml');
    const sitemap = await sitemapResponse.text();
    expect(sitemap).toContain(`/${source.locale}/blog/${source.slug}`);
    expect(sitemap).toContain(`/${sibling.locale}/blog/${sibling.slug}`);
    expect(sitemap).toContain('/th');
    expect(sitemap).toContain('/en');

    const robotsResponse = await publicPage.request.get('/robots.txt');
    expect(robotsResponse.status()).toBe(200);
    const robots = await robotsResponse.text();
    expect(robots).toContain('User-agent: OAI-SearchBot');
    expect(robots).toContain('Disallow: /api/');
    expect(robots).toContain('Sitemap:');

    const rawHtml = await response!.text();
    // The E2E harness uses Astro dev; remove only its injected HMR, toolbar, and CSS module scripts.
    const html = rawHtml.replace(
      /<script[^>]+type=["']module["'][^>]+src=["'](?:\/@vite\/client|\/@fs\/[^"']+\/astro\/dist\/runtime\/client\/dev-toolbar\/entrypoint\.js[^"']*|\/node_modules\/@astrojs\/tailwind\/base\.css|\/src\/styles\/global\.css)["'][^>]*><\/script>/gi,
      '',
    );
    expect(html).not.toMatch(/<script[^>]+type=["']module["']/i);
    expect(html.match(/<script(?![^>]*type=["']application\/ld\+json["'])[^>]*>/gi) ?? []).toEqual([]);
    expect(html).not.toContain('astro-island');
    expect(html).not.toContain('data-page-transition');
    expect(html).not.toContain('alert("unsafe")');
    expect(html).toContain('Public media regression');

    const unpublishResponse = await page.request.put('/api/posts', {
      data: {
        ...postBody(sibling.title, sibling.slug, sibling.content_html),
        id: sibling.id,
        status: 'draft',
      },
    });
    expect(unpublishResponse.status()).toBe(200);
    const unpublishedResponse = await publicPage.goto(`/${sibling.locale}/blog/${sibling.slug}`);
    expect(unpublishedResponse?.status()).toBe(404);
    await publicPage.goto(`/${source.locale}/blog/${source.slug}`);
    await expect(publicPage.locator(`link[rel="alternate"][hreflang="${sibling.locale}"]`)).toHaveCount(0);
    await expect(publicPage.locator(`header a[href="/${sibling.locale}/blog/${sibling.slug}"]`)).toHaveCount(0);

    try {
      const { error: updateSettingsError } = await admin
        .from('site_settings')
        .update({ default_locale: sibling.locale })
        .eq('id', true);
      if (updateSettingsError) throw updateSettingsError;
      await publicPage.waitForTimeout(5_100);

      await publicPage.goto(`/${source.locale}/blog/${source.slug}`);
      await expect(publicPage.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveCount(0);
      const fallbackLegacy = await publicPage.request.get(`/blog/${source.slug}`, { maxRedirects: 0 });
      expect(fallbackLegacy.status()).toBe(301);
      expect(fallbackLegacy.headers().location).toBe(`/${source.locale}/blog/${source.slug}`);
    } finally {
      const { error: restoreSettingsError } = await admin
        .from('site_settings')
        .update({ default_locale: defaultLocale })
        .eq('id', true);
      if (restoreSettingsError) throw restoreSettingsError;
      await publicPage.waitForTimeout(5_100);
    }

    await publicPage.goto(`/${defaultLocale}`);
    const websiteData = JSON.parse(
      (await publicPage.locator('script[type="application/ld+json"]').textContent()) ?? '{}',
    ) as Record<string, unknown>;
    expect(websiteData).toMatchObject({ '@context': 'https://schema.org', '@type': 'WebSite', inLanguage: defaultLocale });

    const invalidLocaleResponse = await publicPage.goto(`/fr/blog/${source.slug}`);
    expect(invalidLocaleResponse?.status()).toBe(404);
    const missingResponse = await publicPage.goto(`/${source.locale}/blog/missing-${crypto.randomUUID()}`);
    expect(missingResponse?.status()).toBe(404);
    await expect(publicPage.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  } finally {
    await noScriptContext?.close();
    await admin.from('posts').delete().eq('author_id', owner.id);
    if (restoreOwner) await restoreOwner();
    await deleteOwner(owner);
  }
});
