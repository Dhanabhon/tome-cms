import assert from 'node:assert/strict';
import test from 'node:test';

import type { EditorDocument } from '../../src/types/cms';

test('a Thai title is saved under a Thai address, through every layer that checks one', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(
    process.env.DATABASE_URL,
    'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
    'use only the disposable Foundation database',
  );
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { createPost, updatePost } = await import('../../src/server/content/posts');
  const { createPage } = await import('../../src/server/content/pages');
  const { getPublishedPage, getPublishedPost } = await import('../../src/server/content/published');
  const { SLUG } = await import('../../src/lib/slug');
  context.after(closeDatabase);

  await migrateToLatest();
  await db.deleteFrom('site_settings').execute();
  await db.deleteFrom('user').execute();
  await db.insertInto('user').values({
    id: 'thai-owner', name: 'Owner', email: 'thai@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: 'thai-owner', site_name: 'TomeCMS', default_locale: 'th', timezone: 'UTC', admin_path: '/studio', author_avatar_media_id: null,
  }).execute();
  const [category] = await db.insertInto('categories').values([
    { owner_id: 'thai-owner', name: 'Uncategorized', is_default: true },
  ]).returningAll().execute();

  const content: EditorDocument = {
    type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'เนื้อหา' }] }],
  };
  const base = {
    excerpt: '', categoryIds: [category!.id], coverMediaId: null, contentJson: content,
    metaDescription: null, metaTitle: null, status: 'published' as const,
  };

  // No slug asked for: the application makes one from the title, and the table takes it.
  // Before this, the application made nothing, and a hand-typed Thai one was refused twice.
  const thai = await createPost('thai-owner', { ...base, slug: '', title: 'เขียนไว้อย่างตั้งใจ เผยแพร่อย่างพิถีพิถัน' });
  assert.match(thai.slug, SLUG);
  assert.ok(/\p{Script=Thai}/u.test(thai.slug), `${thai.slug} is not in the language of its title`);
  assert.ok(await getPublishedPost('th', thai.slug), 'and a reader finds it there');

  // Typed by hand, in Thai, it is kept as typed.
  const typed = await createPost('thai-owner', { ...base, slug: 'สวัสดี-โลก', title: 'Hello' });
  assert.equal(typed.slug, 'สวัสดี-โลก');

  // An existing English address survives a save untouched -- every save normalises the
  // slug it is given, and moving one would break every link to the article.
  const english = await createPost('thai-owner', { ...base, slug: 'claude-code-intentmd-anthropic', title: 'Claude' });
  const saved = await updatePost('thai-owner', {
    ...base, id: english.id, slug: english.slug, title: 'Claude, retitled', updatedAt: english.updated_at,
  });
  assert.equal(saved.slug, 'claude-code-intentmd-anthropic');

  // Pages take the same rule, and have the same constraint to get past.
  const page = await createPage('thai-owner', {
    contentJson: content, excerpt: '', metaDescription: null, metaTitle: null,
    slug: '', status: 'published', title: 'เกี่ยวกับเรา',
  });
  assert.ok(/\p{Script=Thai}/u.test(page.slug), page.slug);
  assert.ok(await getPublishedPage('th', page.slug), 'and a reader finds the page too');
});
