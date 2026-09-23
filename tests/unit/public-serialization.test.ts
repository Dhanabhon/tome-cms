import assert from 'node:assert/strict';
import test from 'node:test';

import { z } from 'zod';

import {
  detailQuerySchema,
  parsePublicQuery,
  postListQuerySchema,
  publicContentSlugSchema,
} from '../../src/server/http/public-schemas';
import {
  serializePublicNavigation,
  serializePublicPage,
  serializePublicPost,
  serializePublicSite,
  serializePublicSlides,
} from '../../src/server/http/serialize';

const media = {
  alt_text: 'A quiet desk',
  checksum_sha256: 'private-checksum',
  created_at: '2026-09-08T01:00:00.000Z',
  folder_id: '0c277f0e-77bf-4123-a822-0e7dbdf870ca',
  height: 900,
  id: 'fbe68a65-49a7-49b8-bcc5-1057c8a1a7cf',
  mime_type: 'image/webp' as const,
  object_key: 'private/object.webp',
  original_name: 'private-original.webp',
  publicUrl: '/media/fbe68a65-49a7-49b8-bcc5-1057c8a1a7cf',
  size_bytes: 12_345,
  updated_at: '2026-09-08T02:00:00.000Z',
  width: 1600,
};

const post = {
  author_id: 'private-owner',
  content_html: '<p>Hello</p><script>private-script</script>',
  content_json: { type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] },
  cover_image: media.publicUrl,
  cover_media_id: media.id,
  created_at: '2026-09-08T00:00:00.000Z',
  id: '2945700a-b92e-46d2-ab94-c845249f5a6d',
  locale: 'th' as const,
  excerpt: '',
  meta_description: null,
  meta_title: 'Hello SEO',
  owner_id: 'private-owner',
  published_at: '2026-09-08T03:00:00.000Z',
  slug: 'hello-world',
  status: 'published' as const,
  title: 'Hello world',
  translation_group_id: 'd54f1382-a9a3-4cf9-b69d-704dbb73db6d',
  updated_at: '2026-09-08T04:00:00.000Z',
};

test('public contracts validate queries and serialize only explicit fields', () => {
  assert.deepEqual(parsePublicQuery(new URLSearchParams('locale=th&limit=10&category=News'), postListQuerySchema), {
    category: 'News', limit: 10, locale: 'th',
  });
  for (const query of ['locale=th&locale=en', 'locale=th&unknown=1', 'locale=th&__proto__=x', 'locale=xx', 'locale=th&limit=51']) {
    assert.throws(() => parsePublicQuery(new URLSearchParams(query), postListQuerySchema), z.ZodError);
  }
  assert.deepEqual(parsePublicQuery(new URLSearchParams('locale=en'), detailQuerySchema), { locale: 'en' });
  assert.equal(publicContentSlugSchema.safeParse('valid-slug').success, true);
  assert.equal(publicContentSlugSchema.safeParse('').success, false);
  assert.equal(publicContentSlugSchema.safeParse('Invalid Slug').success, false);

  const publicPost = serializePublicPost({
    ...post,
    categories: [{ id: '8229dd4f-7f40-4557-ab52-fe1d83594321', name: 'News' }],
    coverImage: media,
    lastModified: new Date(post.updated_at),
    media: [media],
    translations: [{ href: '/en/blog/hello-world', locale: 'en' }],
  });
  assert.deepEqual(publicPost, {
    categories: [{ id: '8229dd4f-7f40-4557-ab52-fe1d83594321', name: 'News' }],
    contentHtml: '<p>Hello</p>',
    contentJson: post.content_json,
    coverImage: {
      altText: media.alt_text, height: 900, id: media.id, mimeType: 'image/webp', sizeBytes: 12_345,
      url: media.publicUrl, width: 1600,
    },
    createdAt: post.created_at,
    id: post.id,
    locale: 'th',
    media: [{
      altText: media.alt_text, height: 900, id: media.id, mimeType: 'image/webp', sizeBytes: 12_345,
      url: media.publicUrl, width: 1600,
    }],
    publishedAt: post.published_at,
    seo: { description: null, title: 'Hello SEO' },
    slug: 'hello-world',
    status: 'published',
    title: 'Hello world',
    translationGroupId: post.translation_group_id,
    translations: [{ href: '/en/blog/hello-world', locale: 'en' }],
    updatedAt: post.updated_at,
  });

  const publicPage = serializePublicPage({
    ...post,
    author_id: 'private-owner',
    lastModified: new Date(post.updated_at),
    media: [media],
    translations: [{ href: '/en/about', locale: 'en' }],
  });
  assert.equal(publicPage.contentHtml, '<p>Hello</p>');
  assert.equal(publicPage.media[0]?.url, media.publicUrl);
  assert.equal('author_id' in publicPage, false);
  assert.equal('cover_media_id' in publicPage, false);

  // What the site wears, as the layout resolves it: addresses only, never a storage key.
  const brand = {
    icon: { png180: 'https://media.test/c.png', png32: 'https://media.test/d.png', svg: null },
    logo: { height: 40, mimeType: 'image/svg+xml' as const, url: 'https://media.test/a.svg', width: 120 },
    logoDark: null,
    showSiteName: false,
  };
  const publicSite = serializePublicSite({
    admin_path: '/private-admin',
    allow_visitor_theme: true,
    show_powered_by: true,
    theme_id: 'paper',
    theme_settings: {},
    author_avatar_media_id: media.id,
    author_bio_en: 'English bio',
    author_bio_th: 'Thai bio',
    author_links: [{ label: 'Site', url: 'https://example.com/' }],
    author_name: 'Tome Author',
    brand_icon: null,
    brand_logo: null,
    brand_logo_dark: null,
    hide_site_name: false,
    maintenance_back_at: null,
    maintenance_copy: {},
    maintenance_enabled: false,
    maintenance_media_id: null,
    maintenance_template: 'minimal' as const,
    default_locale: 'th',
    id: true,
    installed_at: new Date('2026-09-01T00:00:00.000Z'),
    owner_id: 'private-owner',
    site_description: 'A public description',
    site_name: 'TomeCMS',
    tagline: 'Publish clearly',
    theme: 'system' as const,
    timezone: 'Asia/Bangkok',
    updated_at: new Date('2026-09-08T04:00:00.000Z'),
  }, media, brand);
  assert.deepEqual(publicSite, {
    author: {
      avatar: {
        altText: media.alt_text, height: 900, id: media.id, mimeType: 'image/webp', sizeBytes: 12_345,
        url: media.publicUrl, width: 1600,
      },
      bio: { en: 'English bio', th: 'Thai bio' },
      links: [{ label: 'Site', url: 'https://example.com/' }],
      name: 'Tome Author',
    },
    brand,
    defaultLocale: 'th',
    description: 'A public description',
    name: 'TomeCMS',
    supportedLocales: ['th', 'en'],
    tagline: 'Publish clearly',
    timezone: 'Asia/Bangkok',
    updatedAt: '2026-09-08T04:00:00.000Z',
  });

  const navigationWithInternalField = {
    footer: [],
    header: [
      { href: '/th', kind: 'home' as const, label: 'Home', newTab: false, owner_id: 'private-owner' },
      { href: 'https://example.com/', kind: 'custom' as const, label: 'Elsewhere', newTab: true },
    ],
  };
  assert.deepEqual(serializePublicNavigation(navigationWithInternalField), {
    footer: [], header: [
      { href: '/th', kind: 'home', label: 'Home', newTab: false },
      { href: 'https://example.com/', kind: 'custom', label: 'Elsewhere', newTab: true },
    ],
  });

  const serialized = JSON.stringify({ publicPage, publicPost, publicSite });
  for (const secret of ['private-owner', '/private-admin', 'private/object.webp', 'private-original.webp', 'private-checksum', 'private-script']) {
    assert.equal(serialized.includes(secret), false);
  }
});

test('a public slide carries what a headless site needs to draw it, and nothing else', () => {
  const slide = {
    align: 'center' as const,
    body: 'Words under it',
    button: { href: '/th/about', label: 'About', newTab: false },
    focus: 'top' as const,
    heading: 'A heading',
    image: { alt: '', height: 1350, src: '/media/5f0c2a9e-3b1d-4c6e-9a8f-7b2d1e0c4a55', width: 2400 },
    overlay: 'soft' as const,
  };
  assert.deepEqual(serializePublicSlides([{ ...slide, ownerId: 'someone' } as typeof slide]), [slide], 'an extra field is dropped');
  assert.throws(() => serializePublicSlides([{ ...slide, button: { ...slide.button, href: 'javascript:alert(1)' } }]),
    'an address the schema would never publish');
  assert.throws(() => serializePublicSlides(Array.from({ length: 6 }, () => slide)), 'six slides are one more than a home page shows');
});
