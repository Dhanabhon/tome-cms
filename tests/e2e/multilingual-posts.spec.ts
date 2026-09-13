import { expect, test } from '@playwright/test';

import { hasMeaningfulContent, readingMinutes } from '../../src/lib/posts';
import type { EditorNode } from '../../src/types/cms';
import { admin, createOwner, deleteOwner, signInAdmin } from './support';

const draftBody = (title: string, slug: string) => ({
  contentHtml: '<p>Draft body</p>',
  contentJson: { content: [{ content: [{ text: 'Draft body', type: 'text' }], type: 'paragraph' }], type: 'doc' },
  slug,
  status: 'draft' as const,
  title,
});

test('post-content helpers accept image-only documents and segment Thai text', () => {
  expect(hasMeaningfulContent({ content: [{ type: 'paragraph' }], type: 'doc' })).toBe(false);
  expect(hasMeaningfulContent({ content: [{ attrs: { src: 'https://example.com/image.jpg' }, type: 'image' }], type: 'doc' })).toBe(true);
  expect(readingMinutes({ content: [{ content: [{ text: 'ภาษาไทย'.repeat(300), type: 'text' }], type: 'paragraph' }], type: 'doc' })).toBeGreaterThan(1);
});

test('direct writes preserve group ownership, immutable editions, and deleted authors', async () => {
  const owner = await createOwner('group-owner');
  const foreignOwner = await createOwner('group-intruder');
  const groups = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  let ownerDeleted = false;
  const row = (authorId: string, group: string, locale: 'th' | 'en', status = 'draft') => ({
    author_id: authorId,
    content_html: '<p>Direct write</p>',
    content_json: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Direct write' }] }] },
    locale,
    slug: `direct-${crypto.randomUUID()}`,
    status,
    title: 'Direct write',
    translation_group_id: group,
  });

  try {
    for (const [index, status] of ['draft', 'published'].entries()) {
      const source = row(owner.id, groups[index], 'th', status);
      const { data: saved, error } = await owner.client.from('posts').insert(source).select('id').single();
      expect(error).toBeNull();
      if (!saved) throw new Error('Direct source was not created.');

      const visible = await foreignOwner.client.from('posts').select('id').eq('id', saved.id);
      expect(visible.error).toBeNull();
      expect(visible.data).toHaveLength(status === 'published' ? 1 : 0);
      const foreignInsert = await foreignOwner.client.from('posts').insert(row(foreignOwner.id, groups[index], 'en'));
      expect(foreignInsert.error?.code).toBe('23514');

      for (const changes of [{ locale: 'en' }, { translation_group_id: crypto.randomUUID() }]) {
        const changed = await owner.client.from('posts').update(changes).eq('id', saved.id);
        expect(changed.error?.code).toBe('23514');
      }
      const changedAuthor = await admin.from('posts').update({ author_id: foreignOwner.id }).eq('id', saved.id);
      expect(changedAuthor.error?.code).toBe('23514');
      const unchanged = await owner.client.from('posts').select('locale, translation_group_id, author_id').eq('id', saved.id).single();
      expect(unchanged.data).toEqual({ locale: 'th', translation_group_id: groups[index], author_id: owner.id });
      const sibling = await owner.client.from('posts').insert(row(owner.id, groups[index], 'en'));
      expect(sibling.error).toBeNull();
    }

    // Both requests start with an empty group, so checking only existing editions cannot serialize ownership.
    const competing = await Promise.all([
      owner.client.from('posts').insert(row(owner.id, groups[2], 'th')),
      foreignOwner.client.from('posts').insert(row(foreignOwner.id, groups[2], 'en')),
    ]);
    expect(competing.filter(({ error }) => error === null)).toHaveLength(1);
    expect(competing.find(({ error }) => error)?.error?.code).toBe('23514');

    await deleteOwner(owner);
    ownerDeleted = true;
    const retained = await admin.from('posts').select('author_id').in('translation_group_id', groups.slice(0, 2));
    expect(retained.error).toBeNull();
    expect(retained.data).toHaveLength(4);
    expect(retained.data?.every(({ author_id }) => author_id === null)).toBe(true);
  } finally {
    await admin.from('posts').delete().in('translation_group_id', groups);
    if (!ownerDeleted) await deleteOwner(owner);
    await deleteOwner(foreignOwner);
  }
});

test('malformed POST and PUT editor payloads return validation errors', async ({ page }) => {
  const owner = await createOwner('malformed-post');
  const valid = draftBody('Payload validation', `validation-${crypto.randomUUID()}`);
  let deeplyNested: EditorNode = { type: 'paragraph' };
  for (let depth = 0; depth < 500; depth++) deeplyNested = { type: 'blockquote', content: [deeplyNested] };
  try {
    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    const created = await page.request.post('/api/admin/posts', { data: valid });
    expect(created.status()).toBe(201);
    const { post } = await created.json();

    for (const method of ['post', 'put'] as const) {
      for (const invalid of [
        { coverImage: 'not a url' },
        { coverImage: 'https://' },
        { contentJson: { type: 'doc', content: [null] } },
        { contentJson: { type: 'doc', content: 'oops' } },
        { contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [null] }] } },
        { contentJson: { type: 'doc', content: [{ type: 'paragraph', content: 'oops' }] } },
        { contentJson: { type: 'doc', content: [{ type: 'text', text: 42 }] } },
        { contentJson: { type: 'doc', content: [deeplyNested] } },
      ]) {
        const response = await page.request[method]('/api/admin/posts', {
          data: { ...valid, slug: `invalid-${crypto.randomUUID()}`, status: 'published', ...invalid, ...(method === 'put' ? { id: post.id } : {}) },
        });
        expect(response.status(), `${method}: ${JSON.stringify(invalid)}`).toBe(400);
        expect((await response.json()).error).toBe('Invalid post payload.');
      }
    }
    const saved = await owner.client.from('posts').select('status, content_html').eq('id', post.id).single();
    expect(saved.data).toEqual({ status: 'draft', content_html: valid.contentHtml });
  } finally {
    await admin.from('posts').delete().eq('author_id', owner.id);
    await deleteOwner(owner);
  }
});

for (const method of ['post', 'put'] as const) {
  for (const location of ['node', 'mark']) {
    test(`malformed ${method.toUpperCase()} ${location} attrs return validation errors without changing the draft`, async ({ page }) => {
      const owner = await createOwner('deep-post-attrs');
      const valid = draftBody('Deep attrs validation', `attrs-${crypto.randomUUID()}`);
      try {
        await signInAdmin(page, owner);
        await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
        const created = await page.request.post('/api/admin/posts', { data: valid });
        expect(created.status()).toBe(201);
        const { post } = await created.json();
        for (const attrs of [
          `{"value":${'{"nested":'.repeat(4_000)}null${'}'.repeat(4_000)}}`,
          `{"value":${'['.repeat(4_000)}null${']'.repeat(4_000)}}`,
          '{"value":1e400}',
        ]) {
          const document = location === 'node'
            ? `{"type":"doc","content":[{"type":"paragraph","attrs":${attrs},"content":[{"type":"text","text":"Changed body"}]}]}`
            : `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Changed body","marks":[{"type":"bold","attrs":${attrs}}]}]}]}`;
          const fields = JSON.stringify({
            ...valid, contentJson: undefined, slug: `invalid-attrs-${crypto.randomUUID()}`, status: 'published',
            ...(method === 'put' ? { id: post.id } : {}),
          });
          // Build raw request JSON so the test client cannot overflow while stringifying deep attrs.
          const body = `${fields.slice(0, -1)},"contentJson":${document}}`;
          expect(Buffer.byteLength(body)).toBeLessThan(1_000_000);
          const response = await page.request[method]('/api/admin/posts', {
            headers: { 'content-type': 'application/json' }, data: body,
          });
          expect.soft(response.status()).toBe(400);
          expect.soft((await response.json()).error).toBe('Invalid post payload.');
        }
        const saved = await page.request.get('/api/admin/posts');
        expect((await saved.json()).posts).toEqual([post]);
      } finally {
        await admin.from('posts').delete().eq('author_id', owner.id);
        await deleteOwner(owner);
      }
    });
  }
}

test('publishing requires meaningful sanitized HTML and accepts rendered image-only articles', async ({ page }) => {
  const owner = await createOwner('rendered-post');
  const valid = draftBody('Rendered validation', `rendered-${crypto.randomUUID()}`);
  const imageDocument = { type: 'doc', content: [{ type: 'image', attrs: { src: 'https://example.com/image.jpg' } }] };
  try {
    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    const created = await page.request.post('/api/admin/posts', { data: valid });
    expect(created.status()).toBe(201);
    const { post } = await created.json();
    for (const method of ['post', 'put'] as const) {
      for (const invalid of [
        { contentHtml: '<script>alert(1)</script>' },
        { contentHtml: '<p>&nbsp; &#32;</p>' },
        { contentHtml: '<p>&#8203;</p>' },
        { contentJson: imageDocument, contentHtml: '' },
        { contentJson: imageDocument, contentHtml: '<img>' },
        { contentJson: imageDocument, contentHtml: '<img src="javascript:alert(1)">' },
        { contentJson: imageDocument, contentHtml: '<img src="https://">' },
      ]) {
        const response = await page.request[method]('/api/admin/posts', {
          data: { ...valid, slug: `invalid-${crypto.randomUUID()}`, status: 'published', ...invalid, ...(method === 'put' ? { id: post.id } : {}) },
        });
        expect(response.status(), `${method}: ${JSON.stringify(invalid)}`).toBe(400);
        expect((await response.json()).issues.properties.contentJson.errors).toContain('Add content before publishing.');
      }
      const response = await page.request[method]('/api/admin/posts', {
        data: {
          ...valid,
          slug: `image-only-${crypto.randomUUID()}`,
          status: 'published',
          contentJson: imageDocument,
          contentHtml: '<img src="https://example.com/image.jpg" alt="Article image" onerror="alert(1)">',
          ...(method === 'put' ? { id: post.id } : {}),
        },
      });
      expect(response.status()).toBe(method === 'post' ? 201 : 200);
      const imagePost = (await response.json()).post;
      expect(imagePost.content_html).toContain('src="https://example.com/image.jpg"');
      expect(imagePost.content_html).not.toContain('onerror');

      const relativeImage = await page.request[method]('/api/admin/posts', {
        data: {
          ...valid,
          slug: `relative-image-${crypto.randomUUID()}`,
          status: 'published',
          contentJson: { type: 'doc', content: [{ type: 'image', attrs: { src: '/article.jpg' } }] },
          contentHtml: '<img src="/article.jpg">',
          ...(method === 'put' ? { id: post.id } : {}),
        },
      });
      expect(relativeImage.status()).toBe(method === 'post' ? 201 : 200);
    }
  } finally {
    await admin.from('posts').delete().eq('author_id', owner.id);
    await deleteOwner(owner);
  }
});

test('normal posts receive the configured locale and an independent translation group', async ({ page }) => {
  const owner = await createOwner('post-migration');
  const slug = `migration-${crypto.randomUUID()}`;

  try {
    const { data: settings, error: settingsError } = await admin
      .from('site_settings')
      .select('default_locale')
      .eq('id', true)
      .single();
    if (settingsError) throw settingsError;

    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    const response = await page.request.post('/api/admin/posts', {
      data: {
        contentHtml: '<p>Existing content</p>',
        contentJson: { content: [{ content: [{ text: 'Existing content', type: 'text' }], type: 'paragraph' }], type: 'doc' },
        slug,
        status: 'draft',
        title: 'Existing post shape',
      },
    });
    expect(response.status()).toBe(201);
    const seeded = (await response.json()).post as { id: string; slug: string; status: string; updated_at: string };

    const { data, error } = await admin
      .from('posts')
      .select('id, locale, slug, status, translation_group_id, updated_at')
      .eq('id', seeded.id)
      .single();

    expect(error).toBeNull();
    expect(data).toMatchObject({
      id: seeded.id,
      locale: settings.default_locale,
      slug: seeded.slug,
      status: seeded.status,
      updated_at: seeded.updated_at,
    });
    expect(data?.translation_group_id).toMatch(/^[0-9a-f-]{36}$/);
  } finally {
    await admin.from('posts').delete().eq('author_id', owner.id);
    await deleteOwner(owner);
  }
});

test('linked editions use server-derived groups and reject invalid translation requests', async ({ page }) => {
  const owner = await createOwner('linked-editions');
  const foreignOwner = await createOwner('foreign-source');
  const sharedSlug = `shared-${crypto.randomUUID()}`;

  try {
    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    const sourceResponse = await page.request.post('/api/admin/posts', {
      data: { ...draftBody('Thai source', sharedSlug), coverImage: 'https://example.com/source-cover.jpg' },
    });
    expect(sourceResponse.status()).toBe(201);
    const source = (await sourceResponse.json()).post as {
      id: string;
      locale: 'th' | 'en';
      translation_group_id: string;
      cover_image: string | null;
    };

    const translationResponse = await page.request.post('/api/admin/posts', {
      data: {
        ...draftBody('English edition', sharedSlug),
        locale: source.locale === 'th' ? 'en' : 'th',
        sourcePostId: source.id,
      },
    });
    expect(translationResponse.status()).toBe(201);
    const translation = (await translationResponse.json()).post as {
      locale: 'th' | 'en';
      translation_group_id: string;
      cover_image: string | null;
    };
    expect(translation.translation_group_id).toBe(source.translation_group_id);
    expect(translation.locale).not.toBe(source.locale);
    expect(translation.cover_image).toBe(source.cover_image);

    const duplicate = await page.request.post('/api/admin/posts', {
      data: {
        ...draftBody('Duplicate edition', `duplicate-${crypto.randomUUID()}`),
        locale: translation.locale,
        sourcePostId: source.id,
      },
    });
    expect(duplicate.status()).toBe(409);

    const { data: foreignPost, error: foreignPostError } = await foreignOwner.client
      .from('posts')
      .insert({
        author_id: foreignOwner.id,
        content_html: '<p>Foreign content</p>',
        content_json: { content: [{ content: [{ text: 'Foreign content', type: 'text' }], type: 'paragraph' }], type: 'doc' },
        locale: 'th',
        slug: `foreign-${crypto.randomUUID()}`,
        status: 'draft',
        title: 'Foreign source',
      })
      .select('id')
      .single();
    expect(foreignPostError).toBeNull();
    if (!foreignPost) throw new Error('Foreign source was not created.');

    const foreignSource = await page.request.post('/api/admin/posts', {
      data: { ...draftBody('Foreign edition', `foreign-edition-${crypto.randomUUID()}`), locale: 'en', sourcePostId: foreignPost.id },
    });
    expect(foreignSource.status()).toBe(404);

    const invalidLocale = await page.request.post('/api/admin/posts', {
      data: { ...draftBody('Invalid locale', `invalid-locale-${crypto.randomUUID()}`), locale: 'fr', sourcePostId: source.id },
    });
    expect(invalidLocale.status()).toBe(400);

    const invalidCover = await page.request.post('/api/admin/posts', {
      data: { ...draftBody('Invalid cover', `invalid-cover-${crypto.randomUUID()}`), coverImage: 'javascript:alert(1)' },
    });
    expect(invalidCover.status()).toBe(400);

    for (const field of ['author_id', 'owner_id', 'translation_group_id']) {
      const protectedField = await page.request.post('/api/admin/posts', {
        data: { ...draftBody(`Protected ${field}`, `protected-${crypto.randomUUID()}`), [field]: crypto.randomUUID() },
      });
      expect(protectedField.status()).toBe(400);
    }

    const emptyPublished = await page.request.post('/api/admin/posts', {
      data: {
        contentHtml: '<p></p>',
        contentJson: { content: [{ type: 'paragraph' }], type: 'doc' },
        slug: `empty-published-${crypto.randomUUID()}`,
        status: 'published',
        title: 'Empty published post',
      },
    });
    expect(emptyPublished.status()).toBe(400);
    expect((await emptyPublished.json()).issues.properties.contentJson.errors).toContain('Add content before publishing.');
  } finally {
    await admin.from('posts').delete().in('author_id', [owner.id, foreignOwner.id]);
    await deleteOwner(owner);
    await deleteOwner(foreignOwner);
  }
});
