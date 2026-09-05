import { expect, test, type BrowserContext } from '@playwright/test';

import { createOwner, deleteOwner, signInAdmin } from './support';

test('published sanitized content renders without public JavaScript', async ({ browser, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The public HTML contract only needs one browser project.');
  const owner = await createOwner('public-blog');
  const slug = `public-media-${crypto.randomUUID()}`;
  let noScriptContext: BrowserContext | undefined;

  try {
    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    const createResponse = await page.request.post('/api/posts', {
      data: {
        contentHtml: '<h2>Public media regression</h2><script>alert("unsafe")</script><p>Visible without JavaScript.</p>',
        contentJson: { content: [{ attrs: { level: 2 }, content: [{ text: 'Public media regression', type: 'text' }], type: 'heading' }], type: 'doc' },
        slug,
        status: 'published',
        title: 'Public media regression',
      },
    });
    expect(createResponse.status()).toBe(201);

    noScriptContext = await browser.newContext({ javaScriptEnabled: false });
    const publicPage = await noScriptContext.newPage();
    const response = await publicPage.goto(`/blog/${slug}`);
    expect(response?.status()).toBe(200);
    await expect(publicPage.getByRole('heading', { name: 'Public media regression', level: 2 })).toBeVisible();
    await expect(publicPage.getByText('Visible without JavaScript.')).toBeVisible();

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
  } finally {
    await noScriptContext?.close();
    await owner.client.from('posts').delete().eq('slug', slug);
    await deleteOwner(owner);
  }
});
