import { expect, test } from '@playwright/test';
import type { APIRoute } from 'astro';
import { createContext } from 'astro/middleware';

import type { Page } from '../../src/types/cms';
import { admin, createOwner, deleteOwner, signInAdmin } from './support';

const document = {
  type: 'doc' as const,
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Page body.' }] }],
};

const pageBody = (title: string, slug?: string) => ({
  title,
  ...(slug === undefined ? {} : { slug }),
  contentJson: document,
  contentHtml: '<p>Page body.</p>',
  status: 'draft' as const,
});

for (const [method, failureMessage] of [
  ['GET', 'The page list could not be loaded.'], ['POST', 'The page could not be created.'],
  ['PUT', 'The page could not be updated.'], ['PATCH', 'The page could not be updated.'],
  ['DELETE', 'The page could not be deleted.'],
] as const) {
  test(`Page ${method} maps provider authentication rejection safely`, async ({ page }, testInfo) => {
    const owner = await createOwner(`page-auth-error-${method.toLowerCase()}`);
    const { createServer } = await import('vite');
    const vite = await createServer({
      configFile: false, envPrefix: 'PUBLIC_', appType: 'custom', cacheDir: testInfo.outputPath('vite-cache'),
      server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
    });
    const originalFetch = globalThis.fetch;
    try {
      await signInAdmin(page, owner);
      const handlers = await vite.ssrLoadModule('/src/pages/api/admin/pages/index.ts') as Record<typeof method, APIRoute>;
      const cookie = (await page.context().cookies()).map(({ name, value }) => `${name}=${value}`).join('; ');
      for (const status of [401, 403, 500, 'unexpected'] as const) {
        let authRequests = 0;
        let dataRequests = 0;
        globalThis.fetch = async (input, init) => {
          const url = new URL(input instanceof Request ? input.url : String(input));
          if (url.pathname === '/auth/v1/user') {
            authRequests += 1;
            if (status === 'unexpected') throw Object.assign(new Error(`Private provider failure ${owner.id}`), { status: 401 });
            return Response.json({
              error_code: status === 500 ? 'unexpected_failure' : 'bad_jwt',
              message: `Private authentication failure ${owner.id}`,
            }, { status });
          }
          if (url.pathname.startsWith('/rest/v1/')) dataRequests += 1;
          return originalFetch(input, init);
        };
        const response = await handlers[method](createContext({
          request: new Request(new URL(`/api/admin/pages?id=${crypto.randomUUID()}`, page.url()), {
            method, headers: { cookie, 'content-type': 'application/json' },
            ...(['POST', 'PUT', 'PATCH'].includes(method) ? { body: JSON.stringify(pageBody('Private page content')) } : {}),
          }), defaultLocale: 'en', locals: { session: null, user: null },
        }));
        const authRejected = status === 401 || status === 403;
        expect(authRequests).toBeGreaterThan(0);
        expect(dataRequests).toBe(0);
        expect.soft(response.status, `${method}, provider status ${status}`).toBe(authRejected ? 401 : 500);
        expect.soft(await response.json()).toEqual({ error: authRejected ? 'Authentication required.' : failureMessage });
      }
    } finally {
      globalThis.fetch = originalFetch;
      await vite.close();
      await deleteOwner(owner);
    }
  });
}

test('requires authentication and rejects malformed or server-owned fields', async ({ page, request }) => {
  const id = crypto.randomUUID();
  for (const response of [
    await request.get('/api/admin/pages'),
    await request.post('/api/admin/pages', { data: pageBody('Unauthorized') }),
    await request.put('/api/admin/pages', { data: { ...pageBody('Unauthorized'), id } }),
    await request.patch('/api/admin/pages', { data: { id, status: 'draft' } }),
    await request.delete(`/api/admin/pages?id=${id}`),
  ]) {
    expect(response.status()).toBe(401);
  }

  const owner = await createOwner('page-validation');
  try {
    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    const malformed = await page.request.post('/api/admin/pages', {
      data: Buffer.from('{'), headers: { 'content-type': 'application/json' },
    });
    expect(malformed.status()).toBe(400);
    expect((await malformed.json()).error).toBe('The request body must be valid JSON.');

    for (const field of ['author_id', 'authorId', 'owner_id', 'translation_group_id']) {
      const response = await page.request.post('/api/admin/pages', {
        data: { ...pageBody(`Protected ${field}`), [field]: crypto.randomUUID() },
      });
      expect(response.status(), field).toBe(400);
      expect((await response.json()).error).toBe('Invalid page payload.');
    }
    const strictPut = await page.request.put('/api/admin/pages', {
      data: { ...pageBody('Strict PUT'), id, owner_id: owner.id },
    });
    expect(strictPut.status()).toBe(400);
    const strictPatch = await page.request.patch('/api/admin/pages', {
      data: { id, status: 'draft', title: 'No extra fields' },
    });
    expect(strictPatch.status()).toBe(400);
  } finally {
    await admin.from('pages').delete().eq('author_id', owner.id);
    await deleteOwner(owner);
  }
});

test('creates sanitized drafts, generates slugs, and rejects reserved or duplicate slugs', async ({ page }) => {
  const owner = await createOwner('page-create');
  try {
    const { data: settings, error: settingsError } = await admin
      .from('site_settings').select('default_locale').eq('id', true).single();
    if (settingsError) throw settingsError;
    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();

    const created = await page.request.post('/api/admin/pages', {
      data: {
        ...pageBody('Generated Page Slug'),
        contentHtml: '<script>alert(1)</script><p onclick="steal()">Safe</p><a href="javascript:steal()">Link</a><img src="https://example.com/a.jpg" onerror="steal()">',
      },
    });
    expect(created.status()).toBe(201);
    const saved = (await created.json()).page as Page;
    expect(saved).toMatchObject({
      author_id: owner.id,
      locale: settings.default_locale,
      slug: 'generated-page-slug',
      status: 'draft',
    });
    expect(saved.content_html).not.toMatch(/script|onclick|onerror|javascript:/);
    expect(saved.content_html).toContain('rel="noopener noreferrer"');
    expect((await admin.from('pages').select('content_html').eq('id', saved.id).single()).data?.content_html).toBe(saved.content_html);

    const longTitle = `${'a'.repeat(159)} b`;
    const longTitlePage = await page.request.post('/api/admin/pages', { data: pageBody(longTitle) });
    expect(longTitlePage.status()).toBe(201);
    const generatedSlug = ((await longTitlePage.json()).page as Page).slug;
    expect(generatedSlug).toHaveLength(159);
    expect(generatedSlug).not.toMatch(/-$/);

    const oversizedSlug = await page.request.post('/api/admin/pages', {
      data: pageBody('Explicit oversized slug', 'a'.repeat(161)),
    });
    expect(oversizedSlug.status()).toBe(400);

    const reserved = await page.request.post('/api/admin/pages', { data: pageBody('Reserved', 'blog') });
    expect(reserved.status()).toBe(400);

    const duplicate = await page.request.post('/api/admin/pages', {
      data: pageBody('Duplicate slug', saved.slug),
    });
    expect(duplicate.status()).toBe(409);
    expect((await duplicate.json()).error).toBe('A page with this slug already exists in this language.');
  } finally {
    await admin.from('pages').delete().eq('author_id', owner.id);
    await deleteOwner(owner);
  }
});

test('creates only owner-linked translation editions', async ({ page }) => {
  const owner = await createOwner('page-translations');
  const foreign = await createOwner('page-foreign-source');
  try {
    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    const sourceResponse = await page.request.post('/api/admin/pages', {
      data: pageBody('Source page', `source-${crypto.randomUUID()}`),
    });
    expect(sourceResponse.status()).toBe(201);
    const source = (await sourceResponse.json()).page as Page;
    const targetLocale = source.locale === 'th' ? 'en' : 'th';

    const translationResponse = await page.request.post('/api/admin/pages', {
      data: {
        ...pageBody('Translated page', `translation-${crypto.randomUUID()}`),
        locale: targetLocale,
        sourcePageId: source.id,
      },
    });
    expect(translationResponse.status()).toBe(201);
    const translation = (await translationResponse.json()).page as Page;
    expect(translation).toMatchObject({
      author_id: owner.id,
      locale: targetLocale,
      translation_group_id: source.translation_group_id,
    });

    const sameLocale = await page.request.post('/api/admin/pages', {
      data: {
        ...pageBody('Same locale', `same-${crypto.randomUUID()}`),
        locale: source.locale,
        sourcePageId: source.id,
      },
    });
    expect(sameLocale.status()).toBe(409);
    expect((await sameLocale.json()).error).toBe('That language edition already exists.');

    const duplicate = await page.request.post('/api/admin/pages', {
      data: {
        ...pageBody('Duplicate edition', `duplicate-${crypto.randomUUID()}`),
        locale: targetLocale,
        sourcePageId: source.id,
      },
    });
    expect(duplicate.status()).toBe(409);
    expect((await duplicate.json()).error).toBe('That language edition already exists.');

    const foreignLocale = source.locale;
    const { data: foreignSource, error } = await foreign.client.from('pages').insert({
      author_id: foreign.id,
      title: 'Foreign source',
      slug: `foreign-${crypto.randomUUID()}`,
      locale: foreignLocale,
      content_json: document,
      content_html: '<p>Foreign</p>',
    }).select('id').single();
    if (error || !foreignSource) throw error ?? new Error('Foreign source was not created.');
    const foreignResponse = await page.request.post('/api/admin/pages', {
      data: {
        ...pageBody('Foreign translation', `foreign-translation-${crypto.randomUUID()}`),
        locale: foreignLocale === 'th' ? 'en' : 'th',
        sourcePageId: foreignSource.id,
      },
    });
    expect(foreignResponse.status()).toBe(404);
    expect((await foreignResponse.json()).error).toBe('Page not found.');
  } finally {
    await admin.from('pages').delete().in('author_id', [owner.id, foreign.id]);
    await deleteOwner(owner);
    await deleteOwner(foreign);
  }
});

test('scopes CRUD to the owner and preserves the first publication timestamp', async ({ page }) => {
  const owner = await createOwner('page-crud');
  const foreign = await createOwner('page-crud-foreign');
  try {
    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    const created = await page.request.post('/api/admin/pages', {
      data: pageBody('Owned page', `owned-${crypto.randomUUID()}`),
    });
    expect(created.status()).toBe(201);
    const owned = (await created.json()).page as Page;
    const { data: foreignPage, error } = await foreign.client.from('pages').insert({
      author_id: foreign.id,
      title: 'Foreign page',
      slug: `foreign-${crypto.randomUUID()}`,
      locale: owned.locale,
      content_json: document,
      content_html: '<p>Foreign</p>',
    }).select('id').single();
    if (error || !foreignPage) throw error ?? new Error('Foreign page was not created.');

    const listed = await page.request.get('/api/admin/pages');
    expect(listed.status()).toBe(200);
    expect((await listed.json()).pages.map(({ id }: Page) => id)).toEqual([owned.id]);

    for (const response of [
      await page.request.put('/api/admin/pages', { data: { ...pageBody('Foreign update'), id: foreignPage.id } }),
      await page.request.patch('/api/admin/pages', { data: { id: foreignPage.id, status: 'published' } }),
      await page.request.delete(`/api/admin/pages?id=${foreignPage.id}`),
    ]) {
      expect(response.status()).toBe(404);
    }

    const emptyCreate = await page.request.post('/api/admin/pages', {
      data: { ...pageBody('Empty publish', `empty-${crypto.randomUUID()}`), contentJson: { type: 'doc', content: [] }, contentHtml: '<p></p>', status: 'published' },
    });
    expect(emptyCreate.status()).toBe(400);

    const emptied = await page.request.put('/api/admin/pages', {
      data: { ...pageBody('Empty draft', owned.slug), id: owned.id, contentJson: { type: 'doc', content: [] }, contentHtml: '' },
    });
    expect(emptied.status()).toBe(200);
    const rejectedPublish = await page.request.patch('/api/admin/pages', {
      data: { id: owned.id, status: 'published' },
    });
    expect(rejectedPublish.status()).toBe(400);
    expect((await rejectedPublish.json()).error).toBe('Add content before publishing.');

    const updated = await page.request.put('/api/admin/pages', {
      data: { ...pageBody('Updated page', owned.slug), id: owned.id, status: 'published' },
    });
    expect(updated.status()).toBe(200);
    const firstPublishedAt = ((await updated.json()).page as Page).published_at;
    expect(firstPublishedAt).not.toBeNull();

    expect((await page.request.patch('/api/admin/pages', { data: { id: owned.id, status: 'draft' } })).status()).toBe(200);
    const republished = await page.request.patch('/api/admin/pages', { data: { id: owned.id, status: 'published' } });
    expect(republished.status()).toBe(200);
    expect(((await republished.json()).page as Page).published_at).toBe(firstPublishedAt);

    const removed = await page.request.delete(`/api/admin/pages?id=${owned.id}`);
    expect(removed.status()).toBe(204);
    expect((await page.request.get('/api/admin/pages').then((response) => response.json())).pages).toEqual([]);
  } finally {
    await admin.from('pages').delete().in('author_id', [owner.id, foreign.id]);
    await deleteOwner(owner);
    await deleteOwner(foreign);
  }
});

test('PATCH does not overwrite a page autosaved after its publication check', async ({ page }, testInfo) => {
  const owner = await createOwner('page-revision');
  const { createServer } = await import('vite');
  const vite = await createServer({
    configFile: false, envPrefix: 'PUBLIC_', appType: 'custom',
    cacheDir: testInfo.outputPath('vite-cache'),
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true },
  });
  const originalFetch = globalThis.fetch;
  try {
    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    const draft = pageBody('Concurrent page', `revision-${crypto.randomUUID()}`);
    const created = await page.request.post('/api/admin/pages', { data: draft });
    expect(created.status()).toBe(201);
    const saved = (await created.json()).page as Page;
    const { PATCH } = await vite.ssrLoadModule('/src/pages/api/admin/pages/index.ts');
    let autosaved = false;
    globalThis.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (!autosaved && (init?.method ?? 'GET') === 'GET' && url.pathname === '/rest/v1/pages' && url.searchParams.get('id') === `eq.${saved.id}`) {
        autosaved = true;
        const update = await page.request.put('/api/admin/pages', {
          data: { ...draft, id: saved.id, contentJson: { type: 'doc', content: [] }, contentHtml: '' },
        });
        expect(update.status()).toBe(200);
      }
      return response;
    };
    const cookie = (await page.context().cookies()).map(({ name, value }) => `${name}=${value}`).join('; ');
    const request = new Request(new URL('/api/admin/pages', page.url()), {
      method: 'PATCH', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ id: saved.id, status: 'published' }),
    });
    const response = await PATCH(createContext({ request, defaultLocale: 'en', locals: { session: null, user: null } }));
    expect(autosaved).toBe(true);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'The page changed. Reload before trying again.' });
  } finally {
    globalThis.fetch = originalFetch;
    await vite.close();
    await admin.from('pages').delete().eq('author_id', owner.id);
    await deleteOwner(owner);
  }
});
