import { expect, test, type Page } from '@playwright/test';

import { cleanupEditor, createOwner, leaseSiteOwner, signInAdmin } from './support';

const draftBody = (title: string, slug: string) => ({
  contentHtml: '<p>Draft body</p>',
  contentJson: { content: [{ content: [{ text: 'Draft body', type: 'text' }], type: 'paragraph' }], type: 'doc' },
  slug,
  status: 'draft' as const,
  title,
});

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('preview opens immediately with the newest draft and requires its owner', async ({ page, browser, playwright }) => {
  const owner = await createOwner('preview-newest');
  const foreignOwner = await createOwner('preview-foreign');
  const restoreSettings = await leaseSiteOwner(owner);
  const anonymous = await playwright.request.newContext();
  const foreignContext = await browser.newContext();
  try {
    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    await page.goto('/admin/new');
    const previewButton = page.getByRole('button', { name: 'Preview', exact: true });
    await expect(previewButton).toBeDisabled();
    await expect(previewButton).toHaveAttribute('title', 'Add a title before opening Preview.');
    const profile = await page.request.put('/api/profile', { data: {
      authorAvatarMediaId: null, authorBioEn: 'Current English profile', authorBioTh: 'ประวัติล่าสุด',
      authorLinks: [], authorName: 'Current preview author',
    } });
    expect(profile.ok()).toBe(true);
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1_000));
    const title = `Newest preview title ${crypto.randomUUID()}`;
    await page.getByLabel('Post title').fill(title);
    await page.locator('.ProseMirror').fill('Newest unsaved sentence');
    const popupPromise = page.waitForEvent('popup');
    await previewButton.click();
    const preview = await popupPromise;
    await expect(preview).toHaveURL(/\/admin\/preview\/[0-9a-f-]+$/);
    await expect(preview.getByRole('heading', { name: title })).toBeVisible();
    await expect(preview.getByText('Newest unsaved sentence')).toBeVisible();
    await expect(preview.getByText('Draft preview', { exact: true })).toBeVisible();
    await expect(preview.getByText('Last saved', { exact: false })).toBeVisible();
    await expect(preview.getByText('Current preview author')).toBeVisible();
    const locale = await preview.locator('html').getAttribute('lang');
    await expect(preview.getByText(locale === 'th' ? 'ประวัติล่าสุด' : 'Current English profile')).toBeVisible();
    await expect(preview.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    await expect(preview.locator('link[rel="canonical"]')).toHaveCount(0);
    const id = preview.url().split('/').at(-1)!;
    await expect(preview.getByRole('link', { name: 'Edit post' })).toHaveAttribute('href', `/admin/edit/${id}`);
    expect((await anonymous.get(preview.url())).status()).toBe(401);
    expect((await page.request.get('/admin/preview/not-a-uuid')).status()).toBe(404);
    expect((await page.request.get(`/admin/preview/${crypto.randomUUID()}`)).status()).toBe(404);
    const foreignPage = await foreignContext.newPage();
    await signInAdmin(foreignPage, foreignOwner);
    await expect(foreignPage.getByRole('link', { name: 'New post' })).toBeVisible();
    const foreignResponse = await foreignPage.goto(preview.url());
    expect(foreignResponse?.status()).toBe(404);
    await expect(foreignPage.getByText('Newest unsaved sentence')).toHaveCount(0);
    await page.goto('/admin');
    await page.getByLabel(`Actions for ${title} (${locale?.toUpperCase()})`).click();
    const rowPreview = page.getByRole('link', { name: 'Preview', exact: true });
    await expect(rowPreview).toHaveAttribute('href', `/admin/preview/${id}`);
    await expect(rowPreview).toHaveAttribute('target', '_blank');
    await expect(rowPreview).toHaveAttribute('rel', 'noopener noreferrer');
  } finally {
    await anonymous.dispose();
    await foreignContext.close();
    await restoreSettings();
    await cleanupEditor(page, owner, foreignOwner);
  }
});

test('preview queues behind an active save and renders only the newest version', async ({ page }) => {
  const owner = await createOwner('preview-save-race');
  let releaseSave = () => {};
  const gate = new Promise<void>((resolve) => { releaseSave = resolve; });
  try {
    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    const response = await page.request.post('/api/posts', { data: { ...draftBody('Preview race', `preview-race-${crypto.randomUUID()}`), status: 'published' } });
    expect(response.ok()).toBe(true);
    const { post } = await response.json();
    await page.goto(`/admin/edit/${post.id}`);
    let firstSave = true;
    let inFlight = 0;
    let maximumInFlight = 0;
    await page.route('**/api/posts', async (route) => {
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      if (firstSave) { firstSave = false; await gate; }
      const saved = await route.fetch();
      inFlight -= 1;
      await route.fulfill({ response: saved });
    });
    await page.locator('.ProseMirror').fill('Older in-flight version');
    await expect(page.getByText('Saving…', { exact: true })).toBeVisible();
    await page.locator('.ProseMirror').fill('Newest queued preview version');
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const preview = await popupPromise;
    await expect(preview.getByText('Preparing draft preview…')).toBeVisible();
    releaseSave();
    await expect(preview).toHaveURL(new RegExp(`/admin/preview/${post.id}$`));
    await expect(preview.getByText('Newest queued preview version')).toBeVisible();
    await expect(preview.getByText('Older in-flight version')).toHaveCount(0);
    expect(maximumInFlight).toBe(1);
    const { data: stored } = await owner.client.from('posts').select('status, content_html').eq('id', post.id).single();
    expect(stored).toMatchObject({ status: 'published', content_html: '<p>Newest queued preview version</p>' });
  } finally {
    releaseSave();
    await cleanupEditor(page, owner);
  }
});

for (const destination of ['Back to Posts', 'existing edition', 'missing edition']) {
  for (const firstAction of ['navigation', 'preview']) {
    test(`editor action lifecycle protects ${destination} with ${firstAction} first`, async ({ page }) => {
      const owner = await createOwner('editor-action-lifecycle');
      let releaseSave = () => {};
      const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
      try {
        await signInAdmin(page, owner);
        await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
        const response = await page.request.post('/api/posts', { data: draftBody('Action lifecycle', `lifecycle-${crypto.randomUUID()}`) });
        expect(response.status()).toBe(201);
        const { post } = await response.json();
        const target = post.locale === 'th' ? 'en' : 'th';
        let destinationPath = destination === 'Back to Posts' ? '/admin' : `/admin/new?sourcePostId=${post.id}&locale=${target}`;
        if (destination === 'existing edition') {
          const sibling = await page.request.post('/api/posts', { data: {
            ...draftBody('Existing edition', `lifecycle-edition-${crypto.randomUUID()}`), locale: target, sourcePostId: post.id,
          } });
          expect(sibling.status()).toBe(201);
          destinationPath = `/admin/edit/${(await sibling.json()).post.id}`;
        }
        await page.goto(`/admin/edit/${post.id}`);
        let inFlight = 0;
        let maximumInFlight = 0;
        await page.route('**/api/posts', async (route) => {
          inFlight += 1;
          maximumInFlight = Math.max(maximumInFlight, inFlight);
          await saveGate;
          const saved = await route.fetch();
          inFlight -= 1;
          await route.fulfill({ response: saved });
        });
        await page.locator('.ProseMirror').fill('Older in-flight draft');
        await expect(page.getByText('Saving…', { exact: true })).toBeVisible();
        await page.locator('.ProseMirror').fill('Newest lifecycle draft');
        const navigation = destination === 'Back to Posts'
          ? page.getByRole('link', { name: destination })
          : page.getByRole('button', { name: `${destination === 'existing edition' ? 'Edit' : 'Add'} ${target.toUpperCase()} translation` });
        const previewButton = page.getByRole('button', { name: 'Preview', exact: true });

        if (firstAction === 'navigation') {
          await navigation.click({ noWaitAfter: true });
          await expect(previewButton).toBeDisabled();
          await previewButton.click({ force: true });
          expect(page.context().pages()).toHaveLength(1);
          releaseSave();
        } else {
          const popupPromise = page.waitForEvent('popup');
          await previewButton.click();
          const preview = await popupPromise;
          await expect(preview.getByText('Preparing draft preview…')).toBeVisible();
          await expect(navigation).toBeDisabled();
          await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled();
          await navigation.click({ force: true, noWaitAfter: true });
          releaseSave();
          await expect(preview).toHaveURL(new RegExp(`/admin/preview/${post.id}$`));
          await expect(preview.getByText('Newest lifecycle draft')).toBeVisible();
          await expect(page).toHaveURL(new RegExp(`/admin/edit/${post.id}$`));
          await expect(navigation).toBeEnabled();
          await navigation.click({ noWaitAfter: true });
        }
        await expect(page).toHaveURL(new URL(destinationPath, page.url()).href);
        const saved = await page.request.get('/api/posts');
        expect((await saved.json()).posts.find((savedPost: { id: string }) => savedPost.id === post.id)).toMatchObject({
          status: 'draft', content_html: '<p>Newest lifecycle draft</p>',
        });
        expect(maximumInFlight).toBe(1);
        await page.goBack();
        await expect(page).toHaveURL(new RegExp(`/admin/edit/${post.id}$`));
        await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeEnabled();
        await expect(page.getByRole('link', { name: 'Back to Posts' })).toBeEnabled();
      } finally {
        releaseSave();
        await cleanupEditor(page, owner);
      }
    });
  }
}

for (const destination of ['clean Back', 'saved Back', 'existing edition', 'missing edition']) {
  for (const recovery of ['browser stop', 'Stay in editor']) {
    test(`cancelled ${destination} recovers through ${recovery} and persists new edits`, async ({ page }, testInfo) => {
      test.skip(recovery === 'browser stop' && testInfo.project.name !== 'desktop', 'Native Navigation API cancellation is covered in Chromium; the fallback is covered in both engines.');
      const owner = await createOwner('editor-cancelled-navigation');
      let releaseDestination = () => {};
      const destinationGate = new Promise<void>((resolve) => { releaseDestination = resolve; });
      try {
        await signInAdmin(page, owner);
        await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
        const response = await page.request.post('/api/posts', { data: draftBody('Cancelled navigation', `cancelled-${crypto.randomUUID()}`) });
        expect(response.status()).toBe(201);
        const { post } = await response.json();
        const target = post.locale === 'th' ? 'en' : 'th';
        let destinationPath = destination.endsWith('Back') ? '/admin' : `/admin/new?sourcePostId=${post.id}&locale=${target}`;
        if (destination === 'existing edition') {
          const sibling = await page.request.post('/api/posts', { data: {
            ...draftBody('Cancelled edition', `cancelled-edition-${crypto.randomUUID()}`), locale: target, sourcePostId: post.id,
          } });
          expect(sibling.status()).toBe(201);
          destinationPath = `/admin/edit/${(await sibling.json()).post.id}`;
        }
        if (recovery === 'Stay in editor') {
          await page.addInitScript(() => Object.defineProperty(window, 'navigation', { value: undefined }));
        }
        await page.goto(`/admin/edit/${post.id}`);
        await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeEnabled();
        if (destination !== 'clean Back') await page.locator('.ProseMirror').fill('Save before the cancelled departure');
        await page.route(new URL(destinationPath, page.url()).href, async (route) => {
          await destinationGate;
          await route.continue();
        });
        const dirtyTitle = `Edited while departing ${post.id}`;
        // Arrange the real browser Stop/button action before navigation; Playwright waits for pending navigations before evaluating a page.
        await page.evaluate(({ recovery, dirtyTitle }) => {
          window.addEventListener('beforeunload', () => {
            window.setTimeout(() => {
              const preview = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Preview')!;
              const back = document.querySelector('a[href="/admin"]')!;
              sessionStorage.setItem('cancelled-navigation-locked', String(preview.disabled && back.getAttribute('aria-disabled') === 'true'));
              const title = document.querySelector('textarea')!;
              Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(title, dirtyTitle);
              title.dispatchEvent(new Event('input', { bubbles: true }));
              if (recovery === 'browser stop') window.stop();
              else [...document.querySelectorAll('button')].find((button) => button.textContent === 'Stay in editor')?.click();
            }, 1_500);
          }, { once: true });
        }, { recovery, dirtyTitle });
        const departure = page.waitForRequest(new URL(destinationPath, page.url()).href);
        const navigation = destination.endsWith('Back')
          ? page.getByRole('link', { name: 'Back to Posts' })
          : page.getByRole('button', { name: `${destination === 'existing edition' ? 'Edit' : 'Add'} ${target.toUpperCase()} translation` });
        await navigation.click({ noWaitAfter: true });
        await departure;
        await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeEnabled();
        await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeEnabled();
        await expect(navigation).toBeEnabled();
        expect(await page.evaluate(() => sessionStorage.getItem('cancelled-navigation-locked'))).toBe('true');
        await expect.poll(async () => {
          const { data, error } = await owner.client.from('posts').select('title').eq('id', post.id).single();
          if (error) throw error;
          return data.title;
        }).toBe(dirtyTitle);
        releaseDestination();
        await page.unrouteAll({ behavior: 'wait' });
        await page.locator('.ProseMirror').fill('Newest content after cancellation');
        const popup = page.waitForEvent('popup');
        await page.getByRole('button', { name: 'Preview', exact: true }).click();
        const preview = await popup;
        await expect(preview.getByText('Newest content after cancellation')).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`/admin/edit/${post.id}$`));
        const saved = await owner.client.from('posts').select('status, content_html').eq('id', post.id).single();
        expect(saved.error).toBeNull();
        expect(saved.data).toEqual({ status: 'draft', content_html: '<p>Newest content after cancellation</p>' });
      } finally {
        releaseDestination();
        await cleanupEditor(page, owner);
      }
    });
  }
}

test('preview waits for Publish queued behind a delayed draft save and preserves its status', async ({ page }) => {
  const owner = await createOwner('preview-publish-race');
  let releaseSave = () => {};
  const gate = new Promise<void>((resolve) => { releaseSave = resolve; });
  try {
    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    const response = await page.request.post('/api/posts', { data: draftBody('Publish preview race', `publish-preview-${crypto.randomUUID()}`) });
    expect(response.ok()).toBe(true);
    const { post } = await response.json();
    await page.goto(`/admin/edit/${post.id}`);
    const statuses: string[] = [];
    await page.route('**/api/posts', async (route) => {
      statuses.push(route.request().postDataJSON().status);
      if (statuses.length === 1) await gate;
      return route.continue();
    });
    await page.locator('.ProseMirror').fill('Delayed draft version');
    await expect(page.getByText('Saving…', { exact: true })).toBeVisible();
    await page.locator('.ProseMirror').fill('Latest published preview version');
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    const previewButton = page.getByRole('button', { name: 'Preview', exact: true });
    await expect(previewButton).toBeDisabled();
    expect(statuses).toEqual(['draft']);
    releaseSave();
    await expect(page.getByRole('button', { name: 'Update', exact: true })).toBeEnabled();
    await expect(previewButton).toBeEnabled();
    const popupPromise = page.waitForEvent('popup');
    await previewButton.click();
    const preview = await popupPromise;
    await expect(preview).toHaveURL(new RegExp(`/admin/preview/${post.id}$`));
    await expect(preview.getByText('Latest published preview version')).toBeVisible();
    expect(statuses).toEqual(['draft', 'published', 'published']);
    await expect(page.getByRole('button', { name: 'Update', exact: true })).toBeVisible();
    const { data: stored } = await owner.client.from('posts').select('status, content_html').eq('id', post.id).single();
    expect(stored).toMatchObject({ status: 'published', content_html: '<p>Latest published preview version</p>' });
  } finally {
    releaseSave();
    await cleanupEditor(page, owner);
  }
});

test('preview save failure persists with same-tab retry and a safe return link', async ({ page }) => {
  const owner = await createOwner('preview-retry');
  let releaseRetry = () => {};
  const retryGate = new Promise<void>((resolve) => { releaseRetry = resolve; });
  try {
    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    const response = await page.request.post('/api/posts', { data: draftBody('Retry preview', `preview-retry-${crypto.randomUUID()}`) });
    expect(response.ok()).toBe(true);
    const { post } = await response.json();
    await page.goto(`/admin/edit/${post.id}`);
    let rejectSave = true;
    let saves = 0;
    await page.route('**/api/posts', async (route) => {
      saves += 1;
      if (rejectSave) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Forced preview save failure' }) });
      await retryGate;
      return route.continue();
    });
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1_000));
    await page.getByLabel('Post title').fill('Retry preview');
    await page.locator('.ProseMirror').fill('Failed draft sentence');
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const preview = await popupPromise;
    await expect(preview.getByText('The latest draft could not be saved.')).toBeVisible();
    await expect(preview.getByRole('link', { name: 'Return to editor' })).toHaveAttribute('href', `/admin/edit/${post.id}`);
    await expect(preview.getByText('Draft body')).toHaveCount(0);
    await expect(preview.getByText('Failed draft sentence')).toHaveCount(0);
    await expect(page.locator('.admin-save-state').getByText('Save failed', { exact: true })).toBeVisible();
    await preview.reload();
    await expect(preview.getByText('The latest draft could not be saved.')).toBeVisible();
    await page.evaluate(() => {
      window.dispatchEvent(new MessageEvent('message', { origin: 'https://foreign.example', data: { type: 'tome-preview-retry' }, source: window }));
      window.dispatchEvent(new MessageEvent('message', { origin: location.origin, data: { type: 'not-a-preview-retry' }, source: window }));
    });
    expect(saves).toBe(1);
    await page.locator('.ProseMirror').fill('Newest sentence after failure');
    await expect(page.locator('.admin-save-state').getByText('Save failed', { exact: true })).toBeVisible();
    rejectSave = false;
    await preview.getByRole('button', { name: 'Try again' }).click();
    const back = page.getByRole('link', { name: 'Back to Posts' });
    await expect(back).toBeDisabled();
    await back.click({ force: true });
    await preview.getByRole('button', { name: 'Try again' }).click();
    releaseRetry();
    await expect(preview).toHaveURL(/\/admin\/preview\/[0-9a-f-]+$/);
    await expect(preview.getByText('Newest sentence after failure')).toBeVisible();
    await expect(preview.getByText('Failed draft sentence')).toHaveCount(0);
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    expect(saves).toBe(2);
    expect(page.context().pages()).toHaveLength(2);
    await preview.goto('/admin/preview/pending?state=save-error&returnTo=https://foreign.example/');
    await expect(preview.getByRole('link', { name: 'Return to editor' })).toHaveAttribute('href', '/admin');
  } finally {
    releaseRetry();
    await cleanupEditor(page, owner);
  }
});

test('Back modifier clicks leave an accepted preview and its editor open', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop modifier-click behavior.');
  const owner = await createOwner('preview-back-modifiers');
  let releaseSave = () => {};
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  try {
    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    const response = await page.request.post('/api/posts', { data: draftBody('Modifier preview', `modifier-${crypto.randomUUID()}`) });
    expect(response.status()).toBe(201);
    const { post } = await response.json();
    await page.goto(`/admin/edit/${post.id}`);
    await page.route('**/api/posts', async (route) => { await saveGate; return route.continue(); });
    await page.locator('.ProseMirror').fill('Modifier-safe preview body');
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const preview = await popupPromise;
    await expect(preview.getByText('Preparing draft preview…')).toBeVisible();
    for (const modifier of ['ControlOrMeta', 'Shift'] as const) {
      const postsPromise = page.context().waitForEvent('page');
      await page.getByRole('link', { name: 'Back to Posts' }).click({ force: true, modifiers: [modifier] });
      const posts = await postsPromise;
      await expect(posts).toHaveURL(/\/admin$/);
      await expect(page).toHaveURL(new RegExp(`/admin/edit/${post.id}$`));
      await expect(preview.getByText('Preparing draft preview…')).toBeVisible();
      await posts.close();
    }
    releaseSave();
    await expect(preview).toHaveURL(new RegExp(`/admin/preview/${post.id}$`));
    await expect(preview.getByText('Modifier-safe preview body')).toBeVisible();
  } finally {
    releaseSave();
    await cleanupEditor(page, owner);
  }
});

test('preview reports a blocked popup without starting a save', async ({ page }) => {
  const owner = await createOwner('preview-popup-blocked');
  try {
    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    await page.goto('/admin/new');
    await expect(page.getByLabel('Post title')).toBeVisible();
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1_000));
    let saves = 0;
    page.on('request', (request) => { if (request.url().endsWith('/api/posts')) saves += 1; });
    await page.getByLabel('Post title').fill('Blocked popup draft');
    await page.evaluate(() => { window.open = () => null; });
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Allow pop-ups for this site to open Preview.');
    expect(saves).toBe(0);
    expect(page.context().pages()).toHaveLength(1);
  } finally {
    await cleanupEditor(page, owner);
  }
});

test('language context resolves owned editions before editor hydration', async ({ page }) => {
  const owner = await createOwner('editor-language-context');
  const foreignOwner = await createOwner('editor-language-context-foreign');
  const coverImage = 'https://example.com/source-cover.jpg';

  try {
    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    const { data: source, error: sourceError } = await owner.client
      .from('posts')
      .insert({
        author_id: owner.id,
        content_html: '<p>Draft body</p>',
        content_json: draftBody('Thai source', `editor-source-${crypto.randomUUID()}`).contentJson,
        cover_image: coverImage,
        locale: 'th',
        slug: `editor-source-${crypto.randomUUID()}`,
        status: 'draft',
        title: 'Thai source',
      })
      .select('id, locale, translation_group_id')
      .single();
    expect(sourceError).toBeNull();
    if (!source) throw new Error('Source post was not created.');
    const targetLocale = source.locale === 'th' ? 'en' : 'th';

    await page.goto(`/admin/edit/${source.id}`);
    const languages = page.getByRole('navigation', { name: 'Post languages' });
    await expect(languages).toContainText(source.locale.toUpperCase());
    await expect(languages).toContainText(`${targetLocale.toUpperCase()} missing`);
    expect(await page.content()).not.toContain(source.translation_group_id);

    await page.goto('/admin');
    await expect(page.getByRole('link', { name: `${targetLocale.toUpperCase()} missing` })).toHaveAttribute(
      'href',
      `/admin/new?sourcePostId=${source.id}&locale=${targetLocale}`,
    );

    await page.goto(`/admin/new?sourcePostId=${source.id}&locale=${targetLocale}`);
    await expect(page.getByLabel('Post title')).toHaveValue('');
    await expect(page.getByText(`${targetLocale.toUpperCase()} draft`)).toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByAltText('Current cover')).toHaveAttribute('src', coverImage);

    const { error: duplicateError } = await owner.client.from('posts').insert({
      author_id: owner.id,
      content_html: '<p>Sibling body</p>',
      content_json: draftBody('English sibling', `editor-sibling-${crypto.randomUUID()}`).contentJson,
      locale: targetLocale,
      slug: `editor-sibling-${crypto.randomUUID()}`,
      status: 'draft',
      title: 'English sibling',
      translation_group_id: source.translation_group_id,
    });
    expect(duplicateError).toBeNull();

    const { data: foreignSource, error: foreignSourceError } = await foreignOwner.client
      .from('posts')
      .insert({
        author_id: foreignOwner.id,
        content_html: '<p>Foreign body</p>',
        content_json: draftBody('Foreign source', `foreign-source-${crypto.randomUUID()}`).contentJson,
        locale: source.locale,
        slug: `foreign-source-${crypto.randomUUID()}`,
        status: 'draft',
        title: 'Foreign source',
      })
      .select('id')
      .single();
    expect(foreignSourceError).toBeNull();
    if (!foreignSource) throw new Error('Foreign source was not created.');

    for (const url of [
      `/admin/new?sourcePostId=${source.id}`,
      `/admin/new?locale=${targetLocale}`,
      `/admin/new?sourcePostId=${source.id}&locale=fr`,
      `/admin/new?sourcePostId=${source.id}&locale=${source.locale}`,
      `/admin/new?sourcePostId=${source.id}&locale=${targetLocale}`,
      `/admin/new?sourcePostId=${crypto.randomUUID()}&locale=${targetLocale}`,
      `/admin/new?sourcePostId=${foreignSource.id}&locale=${targetLocale}`,
    ]) {
      const response = await page.goto(url);
      expect(response?.status(), url).toBe(404);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
      await expect(page.getByText('Post not found.')).toBeVisible();
      await expect(page.getByText('Thai source')).toHaveCount(0);
      await expect(page.getByText('Foreign source')).toHaveCount(0);
      expect(await page.content()).not.toContain(coverImage);
    }
  } finally {
    await cleanupEditor(page, owner, foreignOwner);
  }
});

test('focused writer uses a centered canvas and accessible settings drawer', async ({ page }, testInfo) => {
  const owner = await createOwner('editor-focused');
  try {
    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    await page.goto('/admin/new');
    await expect(page.getByLabel('Post title')).toBeVisible();
    await expect(page.locator('.admin-sidebar')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save draft' })).toHaveCount(0);
    const canvas = page.locator('.admin-editor-canvas');
    const bounds = await canvas.boundingBox();
    if (!bounds) throw new Error('Canvas is not measurable.');
    expect(bounds.width).toBeLessThanOrEqual(760);
    expect(Math.abs(bounds.x + bounds.width / 2 - page.viewportSize()!.width / 2)).toBeLessThan(2);
    const settings = page.getByRole('button', { name: 'Settings', exact: true });
    for (const name of ['Back to Posts', 'Preview', 'Settings', 'Publish']) {
      await expect(name === 'Back to Posts' ? page.getByRole('link', { name, exact: true }) : page.getByRole('button', { name, exact: true })).toBeInViewport();
    }
    const languageControls = page.getByRole('navigation', { name: 'Post languages' }).getByRole('button');
    await expect(languageControls).toHaveCount(1);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    if (testInfo.project.name === 'mobile') {
      for (const width of [320, 375, 414]) {
        await page.setViewportSize({ width, height: 800 });
        await expectNoHorizontalOverflow(page);
        for (const control of await languageControls.all()) {
          const target = await control.boundingBox();
          expect(target?.width).toBeGreaterThanOrEqual(44);
          expect(target?.height).toBeGreaterThanOrEqual(44);
        }
        await expect(settings).toBeInViewport();
      }
      await page.setViewportSize({ width: 414, height: 800 });
    }
    await settings.click();
    const drawer = page.getByRole('dialog', { name: 'Post settings' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Close settings' })).toBeFocused();
    for (const name of ['Slug', 'Meta title', 'Meta description', 'Upload new']) {
      await expect(drawer.getByLabel(name)).toBeAttached();
    }
    await expect(drawer.getByRole('button', { name: 'Choose from library' })).toBeVisible();
    if (testInfo.project.name === 'mobile') {
      const drawerBounds = await drawer.boundingBox();
      expect(drawerBounds?.width).toBe(page.viewportSize()!.width);
      expect(drawerBounds?.height).toBe(page.viewportSize()!.height);
    }
    expect(await drawer.evaluate((element) => {
      const style = getComputedStyle(element);
      return [...style.transitionDuration.split(','), ...style.animationDuration.split(',')]
        .every((duration) => Number.parseFloat(duration) * (duration.includes('ms') ? 1 : 1000) <= 150);
    })).toBe(true);
    await page.keyboard.press('Escape');
    await expect(drawer).not.toBeVisible();
    await expect(settings).toBeFocused();
    await page.getByRole('link', { name: 'Back to Posts' }).click();
    await expect(page).toHaveURL(/\/admin$/);
  } finally {
    await cleanupEditor(page, owner);
  }
});

test('publishing surfaces stay within the required project-specific viewports', async ({ page }, testInfo) => {
  const owner = await createOwner('publishing-widths');
  const restoreSettings = await leaseSiteOwner(owner);
  const widths = testInfo.project.name === 'mobile' ? [320, 375, 414] : [768, 1280, 1440];
  const sourceSlug = `width-source-${crypto.randomUUID()}`;
  const siblingSlug = `width-sibling-${crypto.randomUUID()}`;

  try {
    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    const sourceResponse = await page.request.post('/api/posts', { data: { ...draftBody('Viewport source', sourceSlug), status: 'published' } });
    expect(sourceResponse.ok()).toBe(true);
    const { post: source } = await sourceResponse.json();
    const siblingLocale = source.locale === 'th' ? 'en' : 'th';
    const siblingResponse = await page.request.post('/api/posts', { data: {
      ...draftBody('Viewport sibling', siblingSlug), locale: siblingLocale, sourcePostId: source.id, status: 'published',
    } });
    expect(siblingResponse.ok()).toBe(true);

    for (const width of widths) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/admin?status=published');
      await expect(page.locator('.admin-shell')).toHaveCount(1);
      await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible();
      await expect(page.getByRole('tablist', { name: 'Post status' })).toBeVisible();
      await expect(page.locator('.admin-story-row')).toHaveCount(2);
      await expectNoHorizontalOverflow(page);

      await page.goto('/admin/profile');
      await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await page.goto('/admin/settings');
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await page.goto(`/admin/edit/${source.id}`);
      await expect(page.getByLabel('Post title')).toBeVisible();
      for (const name of ['Back to Posts', 'Preview', 'Settings', 'Update']) {
        await expect(name === 'Back to Posts' ? page.getByRole('link', { name, exact: true }) : page.getByRole('button', { name, exact: true })).toBeInViewport();
      }
      const languageControls = page.getByRole('navigation', { name: 'Post languages' }).getByRole('button');
      await expect(languageControls).toHaveCount(1);
      for (const control of await languageControls.all()) {
        const target = await control.boundingBox();
        expect(target?.width).toBeGreaterThanOrEqual(44);
        expect(target?.height).toBeGreaterThanOrEqual(44);
      }
      await expectNoHorizontalOverflow(page);
      const settings = page.getByRole('button', { name: 'Settings', exact: true });
      await settings.click();
      const drawer = page.getByRole('dialog', { name: 'Post settings' });
      await expect(drawer).toBeVisible();
      if (width <= 414) {
        const bounds = await drawer.boundingBox();
        expect(bounds?.width).toBe(width);
        expect(bounds?.height).toBe(800);
      }
      await expectNoHorizontalOverflow(page);
      await page.keyboard.press('Escape');
      await expect(settings).toBeFocused();

      await page.goto(`/admin/preview/${source.id}`);
      await expect(page.getByRole('heading', { name: 'Viewport source' })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await page.goto(`/${source.locale}`);
      await expect(page.getByRole('main')).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await page.goto(`/${source.locale}/blog/${source.slug}`);
      await expect(page.locator(`header a[href="/${siblingLocale}/blog/${siblingSlug}"]`)).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
  } finally {
    await restoreSettings();
    await cleanupEditor(page, owner);
  }
});

test('edition navigation serializes delayed saves and keeps the newest text', async ({ page }) => {
  const owner = await createOwner('editor-save-race');
  let releaseSave = () => {};
  const releaseFirstSave = new Promise<void>((resolve) => { releaseSave = resolve; });
  try {
    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    const response = await page.request.post('/api/posts', { data: draftBody('Race source', `race-${crypto.randomUUID()}`) });
    expect(response.ok()).toBe(true);
    const { post } = await response.json();
    await page.goto(`/admin/edit/${post.id}`);
    let firstSave = true;
    let inFlight = 0;
    let maximumInFlight = 0;
    await page.route('**/api/posts', async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      if (firstSave) {
        firstSave = false;
        await releaseFirstSave;
      }
      const saved = await route.fetch();
      inFlight -= 1;
      await route.fulfill({ response: saved });
    });
    const editor = page.locator('.ProseMirror');
    await editor.fill('First version');
    await expect(page.getByText('Saving…', { exact: true })).toBeVisible();
    await editor.fill('Newest version');
    const target = post.locale === 'th' ? 'EN' : 'TH';
    await page.getByRole('button', { name: `Add ${target} translation` }).click();
    expect(page.url()).toContain(`/admin/edit/${post.id}`);
    releaseSave();
    await expect(page).toHaveURL(new RegExp(`/admin/new\\?sourcePostId=${post.id}&locale=${target.toLowerCase()}`));
    const { data: stored, error } = await owner.client.from('posts').select('content_html').eq('id', post.id).single();
    expect(error).toBeNull();
    expect(stored?.content_html).toContain('Newest version');
    expect(maximumInFlight).toBe(1);
    await expect(page.getByLabel('Post title')).toHaveValue('');
    await expect(page.locator('.ProseMirror')).toHaveText('');
  } finally {
    releaseSave();
    await cleanupEditor(page, owner);
  }
});

test('failed save stops leaving and retry preserves edits before Back to Posts', async ({ page }) => {
  const owner = await createOwner('editor-save-retry');
  let releaseRetry = () => {};
  const retryGate = new Promise<void>((resolve) => { releaseRetry = resolve; });
  try {
    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    await page.goto('/admin/new');
    let rejectSave = true;
    await page.route('**/api/posts', async (route) => {
      if (rejectSave) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Forced save failure' }) });
      await retryGate;
      return route.continue();
    });
    const title = `Retry source ${crypto.randomUUID()}`;
    await page.getByLabel('Post title').fill(title);
    await page.locator('.ProseMirror').fill('Keep this draft');
    await page.getByRole('link', { name: 'Back to Posts' }).click();
    await expect(page.locator('.admin-save-state').getByText('Save failed', { exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Forced save failure');
    await expect(page.getByRole('alert').getByText('Save failed', { exact: true })).toBeVisible();
    expect(page.url()).toContain('/admin/new');
    rejectSave = false;
    await page.locator('.ProseMirror').fill('Edited after save failed');
    await expect(page.locator('.admin-save-state').getByText('Save failed', { exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Forced save failure');
    await expect(page.getByRole('button', { name: 'Retry save' })).toBeVisible();
    const retry = page.waitForRequest((request) => request.url().endsWith('/api/posts') && request.method() === 'POST');
    await page.getByRole('button', { name: 'Retry save' }).click();
    await retry;
    await expect(page.locator('.admin-save-state').getByText('Save failed', { exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Forced save failure');
    await expect(page.getByRole('button', { name: 'Retry save' })).toBeVisible();
    releaseRetry();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry save' })).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    const { data: retried } = await owner.client.from('posts').select('content_html').eq('title', title).single();
    expect(retried?.content_html).toContain('Edited after save failed');
    await page.locator('.ProseMirror').fill('Newest before leaving');
    await page.getByRole('link', { name: 'Back to Posts' }).click();
    await expect(page).toHaveURL(/\/admin$/);
    const { data, error } = await owner.client.from('posts').select('content_html').eq('title', title).single();
    expect(error).toBeNull();
    expect(data?.content_html).toContain('Newest before leaving');
  } finally {
    releaseRetry();
    await cleanupEditor(page, owner);
  }
});

test('manual translation saves its edition and publishes only that edition', async ({ page }) => {
  const owner = await createOwner('editor-manual-edition');
  try {
    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    const response = await page.request.post('/api/posts', { data: draftBody('Original draft', `original-${crypto.randomUUID()}`) });
    expect(response.ok()).toBe(true);
    const { post: source } = await response.json();
    const target = source.locale === 'th' ? 'en' : 'th';
    await page.goto(`/admin/new?sourcePostId=${source.id}&locale=${target}`);
    await expect(page.getByLabel('Post title')).toHaveValue('');
    const title = `Manual edition ${crypto.randomUUID()}`;
    const creation = page.waitForRequest((request) => request.url().endsWith('/api/posts') && request.method() === 'POST');
    await page.getByLabel('Post title').fill(title);
    await page.locator('.ProseMirror').fill('Manually written translation');
    const request = await creation;
    expect(request.postDataJSON()).toMatchObject({ locale: target, sourcePostId: source.id });
    expect(request.postDataJSON()).not.toHaveProperty('translation_group_id');
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/edit\//);
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByText(`${target.toUpperCase()} published`, { exact: true })).toBeVisible();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    await page.locator('.ProseMirror').fill('Final translation before switching');
    await page.getByRole('button', { name: `Edit ${source.locale.toUpperCase()} translation` }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/edit/${source.id}$`));
    const { data: editions, error } = await owner.client.from('posts').select('locale, status, content_html').eq('translation_group_id', source.translation_group_id);
    expect(error).toBeNull();
    expect(editions).toHaveLength(2);
    expect(editions?.find((edition) => edition.locale === source.locale)?.status).toBe('draft');
    expect(editions?.find((edition) => edition.locale === target)).toMatchObject({
      status: 'published', content_html: '<p>Final translation before switching</p>',
    });
  } finally {
    await cleanupEditor(page, owner);
  }
});
