import { expect, test } from '@playwright/test';

import { admin, createOwner, deleteOwner, signInAdmin } from './support';

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
    const response = await page.request.post('/api/posts', {
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
