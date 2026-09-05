import { expect, test, type BrowserContext } from '@playwright/test';

import { getPublicSiteUrl } from '../../src/lib/seo';
import { admin, createOwner, deleteOwner, signInAdmin } from './support';

test('published sanitized content renders without public JavaScript', async ({ browser, page }, testInfo) => {
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
  const metaTitle = 'Answer-ready public article';
  let createdPostId: string | undefined;
  let noScriptContext: BrowserContext | undefined;

  try {
    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    const createResponse = await page.request.post('/api/posts', {
      data: {
        contentHtml: '<h2>Public media regression</h2><script>alert("unsafe")</script><p>Visible without JavaScript.</p>',
        contentJson: {
          content: [
            { attrs: { level: 2 }, content: [{ text: 'Public media regression', type: 'text' }], type: 'heading' },
            { content: [{ text: 'Visible without JavaScript.', type: 'text' }], type: 'paragraph' },
          ],
          type: 'doc',
        },
        metaTitle,
        slug,
        status: 'published',
        title: 'Public media regression',
      },
    });
    expect(createResponse.status()).toBe(201);
    const { data: createdPost, error: createdPostError } = await admin
      .from('posts')
      .select('id, published_at, updated_at')
      .eq('slug', slug)
      .single();
    if (createdPostError) throw createdPostError;
    createdPostId = createdPost.id;

    noScriptContext = await browser.newContext({ javaScriptEnabled: false });
    const publicPage = await noScriptContext.newPage();
    const response = await publicPage.goto(`/blog/${slug}`);
    expect(response?.status()).toBe(200);
    expect(await publicPage.title()).toContain(metaTitle);
    await expect(publicPage.locator('meta[name="description"]')).toHaveAttribute('content', expectedDescription);
    await expect(publicPage.locator('meta[name="robots"]')).toHaveAttribute('content', /index, follow/);
    await expect(publicPage.locator('meta[property="article:published_time"]')).toHaveAttribute('content', createdPost.published_at!);
    await expect(publicPage.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`/blog/${slug}$`));
    await expect(publicPage.getByRole('heading', { name: 'Public media regression', level: 2 })).toBeVisible();
    await expect(publicPage.getByText('Visible without JavaScript.')).toBeVisible();

    const structuredData = JSON.parse(
      (await publicPage.locator('script[type="application/ld+json"]').textContent()) ?? '{}',
    ) as Record<string, unknown>;
    expect(structuredData).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      dateModified: createdPost.updated_at,
      datePublished: createdPost.published_at,
      description: expectedDescription,
      headline: 'Public media regression',
    });

    const sitemapResponse = await publicPage.request.get('/sitemap.xml');
    expect(sitemapResponse.status()).toBe(200);
    expect(sitemapResponse.headers()['content-type']).toContain('application/xml');
    expect(await sitemapResponse.text()).toContain(`/blog/${slug}`);

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
    expect(html).not.toContain('astro-island');
    expect(html).not.toContain('alert("unsafe")');
    expect(html).toContain('Public media regression');

    await publicPage.goto('/');
    const websiteData = JSON.parse(
      (await publicPage.locator('script[type="application/ld+json"]').textContent()) ?? '{}',
    ) as Record<string, unknown>;
    expect(websiteData).toMatchObject({ '@context': 'https://schema.org', '@type': 'WebSite' });

    const missingResponse = await publicPage.goto(`/blog/missing-${crypto.randomUUID()}`);
    expect(missingResponse?.status()).toBe(404);
    await expect(publicPage.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  } finally {
    await noScriptContext?.close();
    const { data: deletedPosts, error: deletePostError } = await admin.from('posts').delete().eq('slug', slug).select('id');
    if (deletePostError) throw deletePostError;
    if (createdPostId && !deletedPosts.some((post) => post.id === createdPostId)) {
      throw new Error('The public blog fixture post was not deleted.');
    }
    await deleteOwner(owner);
  }
});
