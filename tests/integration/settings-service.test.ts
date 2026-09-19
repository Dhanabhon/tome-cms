import assert from 'node:assert/strict';
import test from 'node:test';

test('PostgreSQL settings validate input, isolate owners, and reject stale writes', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(
    process.env.DATABASE_URL,
    'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
    'use only the disposable Foundation database',
  );
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const {
    getOwnerSettings,
    getSiteSettings,
    profileMutationSchema,
    siteSettingsMutationSchema,
    updateOwnerProfile,
    updateSiteSettings,
  } = await import('../../src/server/content/settings');
  const { HttpError } = await import('../../src/server/http/errors');
  context.after(closeDatabase);

  await migrateToLatest();
  await db.insertInto('user').values([
    { id: 'owner-a', name: 'Owner A', email: 'a@example.invalid', emailVerified: true, image: null, role: 'owner' },
    { id: 'owner-b', name: 'Owner B', email: 'b@example.invalid', emailVerified: true, image: null, role: 'owner' },
  ]).execute();
  await db.insertInto('site_settings').values({
    id: true,
    owner_id: 'owner-a',
    site_name: 'TomeCMS',
    tagline: 'Independent publishing.',
    site_description: '',
    default_locale: 'th',
    timezone: 'Asia/Bangkok',
    admin_path: '/studio',
    author_avatar_media_id: null,
  }).execute();

  const initial = await getSiteSettings();
  assert.equal(initial?.owner_id, 'owner-a');
  assert.equal(await getOwnerSettings('owner-b'), null);
  assert.equal(siteSettingsMutationSchema.safeParse({
    allowVisitorTheme: true, showPoweredBy: true, themeId: 'paper', defaultLocale: 'en', siteDescription: '', siteName: ' ', tagline: '', theme: 'system', timezone: 'UTC', updatedAt: initial?.updated_at.toISOString(),
  }).success, false, 'a blank site name is rejected');
  assert.equal(siteSettingsMutationSchema.safeParse({
    allowVisitorTheme: true, showPoweredBy: true, themeId: 'paper', defaultLocale: 'en', siteDescription: '', siteName: 'Valid', tagline: '', theme: 'sepia', timezone: 'UTC', updatedAt: initial?.updated_at.toISOString(),
  }).success, false, 'only the three theme states are accepted');
  assert.equal(profileMutationSchema.safeParse({
    authorAvatarMediaId: crypto.randomUUID(), authorBioEn: '', authorBioTh: '', authorLinks: [], authorName: '', updatedAt: initial?.updated_at.toISOString(),
  }).success, true, 'the PostgreSQL File Manager accepts media identities');

  const settings = await updateSiteSettings('owner-a', {
    allowVisitorTheme: false,
    showPoweredBy: false,
    themeId: 'paper',
    defaultLocale: 'en',
    siteDescription: 'A multilingual publication.',
    siteName: 'Tome Journal',
    tagline: 'Ideas worth keeping.',
    theme: 'dark',
    timezone: 'UTC',
    updatedAt: initial!.updated_at.toISOString(),
  });
  assert.equal(settings.site_name, 'Tome Journal');
  assert.equal(settings.theme, 'dark', 'the site theme is stored and returned');
  assert.equal(settings.allow_visitor_theme, false, 'the visitor theme control can be switched off');
  assert.equal(settings.show_powered_by, false, 'the footer credit can be switched off');
  assert.equal(settings.theme_id, 'paper', 'the chosen theme round-trips');
  assert.equal(initial?.show_powered_by, true, 'a fresh installation shows the credit');
  assert.equal(initial?.allow_visitor_theme, true, 'a fresh installation offers visitors the control');
  assert.equal(initial?.theme, 'system', 'a fresh installation follows each visitor\'s own setting');
  assert.notEqual(settings.updated_at.toISOString(), initial!.updated_at.toISOString());

  await assert.rejects(
    updateSiteSettings('owner-a', {
      allowVisitorTheme: true, showPoweredBy: true, themeId: 'paper', defaultLocale: 'th', siteDescription: '', siteName: 'Stale', tagline: '', theme: 'light', timezone: 'Asia/Bangkok', updatedAt: initial!.updated_at.toISOString(),
    }),
    (error: unknown) => error instanceof HttpError && error.status === 409,
  );
  assert.equal((await getOwnerSettings('owner-a'))?.site_name, 'Tome Journal');

  const profile = await updateOwnerProfile('owner-a', {
    authorAvatarMediaId: null,
    authorBioEn: 'English biography',
    authorBioTh: 'ประวัติภาษาไทย',
    authorLinks: [{ label: 'Website', url: 'https://example.com/about' }],
    authorName: 'Tome Owner',
    updatedAt: settings.updated_at.toISOString(),
  });
  assert.deepEqual(profile.author_links, [{ label: 'Website', url: 'https://example.com/about' }]);
  assert.equal(profile.author_name, 'Tome Owner');

  await assert.rejects(
    updateOwnerProfile('owner-b', {
      authorAvatarMediaId: null, authorBioEn: '', authorBioTh: '', authorLinks: [], authorName: 'Other', updatedAt: profile.updated_at.toISOString(),
    }),
    (error: unknown) => error instanceof HttpError && error.status === 404,
  );
});
