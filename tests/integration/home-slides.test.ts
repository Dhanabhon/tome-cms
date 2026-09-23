import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

test('slides are kept per language, refused when they point outside the site, and read live', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { HttpError } = await import('../../src/server/http/errors');
  const { homeSlidesSchema } = await import('../../src/lib/home-slides');
  const { getPublicSlidesSnapshot, listSlides, replaceSlides } = await import('../../src/server/content/slides');
  const { pagePath } = await import('../../src/lib/i18n');
  context.after(closeDatabase);

  await migrateToLatest();
  const ownerId = randomUUID();
  await db.insertInto('user').values({
    id: ownerId, name: 'Owner', email: 'slides@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: ownerId, site_name: 'Slides', default_locale: 'th', timezone: 'UTC', admin_path: '/admin',
  }).execute();
  const stored = {
    owner_id: ownerId, folder_id: null, checksum_sha256: `${'A'.repeat(43)}=`, state: 'ready' as const, delete_error_code: null,
  };
  const media = async (values: Record<string, unknown>) => (await db.insertInto('media_items').values({
    ...stored, object_key: `owners/${ownerId}/2026/09/${randomUUID()}`, original_name: 'file',
    mime_type: 'image/jpeg', size_bytes: 400_000, width: 2400, height: 1350, alt_text: 'A lake at dawn', ...values,
  } as never).returning('id').executeTakeFirstOrThrow()).id;
  const lake = await media({});
  const unnamed = await media({ alt_text: null });
  const guide = await media({ mime_type: 'application/pdf', width: null, height: null, alt_text: null });
  const page = async (status: 'draft' | 'published', locale: 'th' | 'en') => {
    const translation = await db.insertInto('page_translation_groups').values({ owner_id: ownerId }).returning('id').executeTakeFirstOrThrow();
    return (await db.insertInto('pages').values({
      owner_id: ownerId, translation_group_id: translation.id, locale, title: `A ${status} page`, slug: `${status}-${locale}-${randomUUID()}`,
      content_json: { type: 'doc', content: [] }, content_html: '', excerpt: '',
      status, published_at: status === 'published' ? new Date('2026-01-01T00:00:00Z') : null,
    } as never).returning(['id', 'slug']).executeTakeFirstOrThrow());
  };
  const about = await page('published', 'th');
  const draft = (await page('draft', 'th')).id;
  const english = (await page('published', 'en')).id;

  const save = (locale: 'th' | 'en', slides: unknown[]) => replaceSlides(ownerId, homeSlidesSchema.parse({ locale, slides }));
  const badRequest = (error: unknown) => error instanceof HttpError && error.status === 400;

  await assert.rejects(save('th', [{ mediaId: guide, heading: 'A guide' }]), badRequest, 'a document is not a picture');
  await assert.rejects(save('th', [{ mediaId: unnamed }]), badRequest, 'a picture with no words of its own and no heading');
  await assert.rejects(save('th', [{ mediaId: lake, button: { label: 'Read', link: { kind: 'page', pageId: english } } }]), badRequest,
    'a page in the other language');
  await assert.rejects(save('th', [{ mediaId: randomUUID(), heading: 'Gone' }]), badRequest, 'a picture that is not in the library');

  const past = '2026-01-01T00:00:00Z';
  const future = '2999-01-01T00:00:00Z';
  await save('th', [
    { mediaId: lake, heading: 'First', button: { label: 'About us', link: { kind: 'page', pageId: about.id } } },
    { mediaId: unnamed, heading: 'No words of its own, but a heading', button: { label: 'Draft', link: { kind: 'page', pageId: draft } } },
    { mediaId: lake, enabled: false },
    { mediaId: lake, startsAt: future },
    { mediaId: lake, endsAt: past },
    { mediaId: lake, button: { label: 'Away', link: { kind: 'custom', url: 'https://example.com/', newTab: true } } },
    { mediaId: lake, heading: 'Five' },
    { mediaId: lake, heading: 'Six', button: { label: 'Home', link: { kind: 'home' } } },
    { mediaId: lake, heading: 'Seven, too many to show' },
  ]);
  await save('en', [{ mediaId: lake, heading: 'English' }]);

  const listed = await listSlides(ownerId);
  assert.equal(listed.slides.filter((slide) => slide.locale === 'th').length, 9, 'all nine are kept, live or not');
  assert.deepEqual(listed.media.map((item) => item.id).sort(), [lake, unnamed].sort(), 'the admin is told about each picture once');

  const { slides } = await getPublicSlidesSnapshot('th');
  assert.deepEqual(slides.map((slide) => slide.heading), ['First', 'No words of its own, but a heading', null, 'Five', 'Six'],
    'the first five live ones, in order: off, waiting and ended are passed over');
  assert.equal(slides[0]!.button?.href, pagePath({ locale: 'th', slug: about.slug }), 'a button to a published page leads to it');
  assert.equal(slides[0]!.image.alt, '', 'a slide with a heading lets the heading speak for it');
  assert.equal(slides[1]!.button, null, 'a button to a draft page is not drawn');
  assert.deepEqual(slides[2]!.image, { alt: 'A lake at dawn', height: 1350, src: `/media/${lake}`, width: 2400 },
    'a slide without a heading takes the library\'s words');
  assert.deepEqual(slides[2]!.button, { href: 'https://example.com/', label: 'Away', newTab: true });
  assert.deepEqual(slides[4]!.button, { href: '/th', label: 'Home', newTab: false });
  assert.deepEqual((await getPublicSlidesSnapshot('en')).slides.map((slide) => slide.heading), ['English'], 'each language its own');

  await save('th', []);
  assert.deepEqual((await getPublicSlidesSnapshot('th')).slides, [], 'saving an empty list empties it, and the cache is told');
});
