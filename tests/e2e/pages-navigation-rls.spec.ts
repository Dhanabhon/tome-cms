import { expect, test } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json, NavigationItemInsert, PageInsert } from '../../src/types/cms';
import { admin, anonKey, createOwner, deleteOwner, supabaseUrl, type TestOwner } from './support';

test.describe('Pages and Navigation database contracts', () => {
  test.describe.configure({ mode: 'serial' });
  test('enforces ownership, edition constraints, timestamps, and atomic menu replacement', async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Database contracts run once on desktop.');
    const owners: TestOwner[] = [];
    try {
      const ownerA = await createOwner('pages-a');
      owners.push(ownerA);
      const ownerB = await createOwner('pages-b');
      owners.push(ownerB);
      const a = ownerA.client as SupabaseClient<Database>;
      const b = ownerB.client as SupabaseClient<Database>;
      const anonymous = createClient<Database>(supabaseUrl, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const draft: PageInsert = {
        author_id: ownerA.id,
        locale: 'th',
        title: 'About us',
        slug: `about-${crypto.randomUUID()}`,
        content_json: { type: 'doc', content: [] },
        content_html: '<p>About us</p>',
      };
      const inserted = await a.from('pages').insert(draft).select().single();
      expect(inserted.error).toBeNull();
      if (!inserted.data) throw new Error('Expected inserted Page.');
      const page = inserted.data;
      expect(page.status).toBe('draft');
      expect(page.published_at).toBeNull();
      expect((await a.from('pages').select('id').eq('id', page.id)).data).toEqual([{ id: page.id }]);

      for (const client of [b, anonymous]) {
        const hidden = await client.from('pages').select('id').eq('id', page.id);
        expect(hidden.error).toBeNull();
        expect(hidden.data).toEqual([]);
      }
      expect((await b.from('pages').insert({ ...draft, slug: `${draft.slug}-forged` })).error?.code).toBe('42501');
      expect((await a.from('pages').insert(draft)).error?.code).toBe('23505');
      expect((await a.from('pages').insert({ ...draft, slug: `${draft.slug}-duplicate`, translation_group_id: page.translation_group_id })).error?.code).toBe('23505');
      expect((await b.from('pages').insert({ ...draft, author_id: ownerB.id, locale: 'en', translation_group_id: page.translation_group_id })).error?.code).toBe('23514');

      const concurrentGroup = crypto.randomUUID();
      const contenders = await Promise.all([
        a.from('pages').insert({ ...draft, slug: `${draft.slug}-race`, translation_group_id: concurrentGroup }).select('id'),
        b.from('pages').insert({ ...draft, author_id: ownerB.id, locale: 'en', slug: `${draft.slug}-race`, translation_group_id: concurrentGroup }).select('id'),
      ]);
      expect(contenders.filter(({ error }) => error === null)).toHaveLength(1);
      expect(contenders.filter(({ error }) => error?.code === '23514')).toHaveLength(1);

      for (const patch of [{ locale: 'en' as const }, { translation_group_id: crypto.randomUUID() }, { author_id: ownerB.id }]) {
        // @ts-expect-error Intentionally bypass immutable mutation fields to verify the database guard.
        expect((await a.from('pages').update({ title: page.title, ...patch }).eq('id', page.id)).error?.code).toBe('23514');
      }
      for (const patch of [{ title: '' }, { title: 'x'.repeat(201) }, { slug: '' }, { slug: 'x'.repeat(161) }, { meta_title: 'x'.repeat(71) }, { meta_description: 'x'.repeat(321) }]) {
        expect((await a.from('pages').update(patch).eq('id', page.id)).error?.code).toBe('23514');
      }

      let previousUpdated = page.updated_at;
      let firstPublished: string | null = null;
      for (const status of ['published', 'published', 'draft', 'published'] as const) {
        const updated = await a.from('pages').update({ status, title: `About ${status}` }).eq('id', page.id).select().single();
        expect(updated.error).toBeNull();
        if (!updated.data) throw new Error('Expected updated Page.');
        expect(Date.parse(updated.data.updated_at)).toBeGreaterThan(Date.parse(previousUpdated));
        previousUpdated = updated.data.updated_at;
        firstPublished ??= updated.data.published_at;
        expect(firstPublished).not.toBeNull();
        expect(updated.data.published_at).toBe(firstPublished);
        const publicRead = await anonymous.from('pages').select('id').eq('id', page.id);
        expect(publicRead.error).toBeNull();
        expect(publicRead.data).toEqual(status === 'published' ? [{ id: page.id }] : []);
        const foreignRead = await b.from('pages').select('id').eq('id', page.id);
        expect(foreignRead.error).toBeNull();
        expect(foreignRead.data).toEqual([]);
      }
      for (const operation of [b.from('pages').update({ title: 'Intruder' }), b.from('pages').delete()]) {
        const result = await operation.eq('id', page.id).select('id');
        expect(result.error).toBeNull();
        expect(result.data).toEqual([]);
      }
      const siblingResult = await a.from('pages').insert({ ...draft, locale: 'en', translation_group_id: page.translation_group_id }).select().single();
      expect(siblingResult.error).toBeNull();
      if (!siblingResult.data) throw new Error('Expected sibling edition.');
      const sibling = siblingResult.data;
      const reference = { owner_id: ownerA.id, locale: 'th' as const, location: 'header' as const, kind: 'page' as const, label: 'About', page_id: page.id, position: 9 };
      expect((await b.from('navigation_items').insert({ ...reference, owner_id: ownerB.id })).error?.code).toBe('23503');
      expect((await a.from('navigation_items').insert({ ...reference, locale: 'en' })).error?.code).toBe('23503');
      const initialReference = await a.from('navigation_items').insert(reference).select().single();
      expect(initialReference.error).toBeNull();
      if (!initialReference.data) throw new Error('Expected initial navigation item.');
      const updatedReference = await a.from('navigation_items').update({ label: 'Updated About' }).eq('id', initialReference.data.id).select().single();
      expect(updatedReference.error).toBeNull();
      expect(Date.parse(updatedReference.data?.updated_at ?? '')).toBeGreaterThan(Date.parse(initialReference.data.updated_at));
      expect((await a.from('navigation_items').insert(reference)).error?.code).toBe('23505');

      const replacement = [
        { kind: 'home', label: ' Home ', page_id: null, url: null },
        { kind: 'page', label: 'About', page_id: page.id, url: null },
        { kind: 'custom', label: 'Contact', page_id: null, url: ' /contact ' },
        { kind: 'custom', label: 'External', page_id: null, url: 'https://example.com/contact' },
      ] satisfies Json;
      const replace = (menu_items: Json) => a.rpc('replace_navigation_items', { target_locale: 'th', target_location: 'header', menu_items });
      const menu = await replace(replacement);
      expect(menu.error).toBeNull();
      expect(menu.data?.map(({ position, label, url }) => ({ position, label, url }))).toEqual([
        { position: 0, label: 'Home', url: null },
        { position: 1, label: 'About', url: null },
        { position: 2, label: 'Contact', url: '/contact' },
        { position: 3, label: 'External', url: 'https://example.com/contact' },
      ]);
      expect((await b.from('navigation_items').select('id').eq('owner_id', ownerA.id)).data).toEqual([]);
      for (const operation of [b.from('navigation_items').update({ label: 'Intruder' }), b.from('navigation_items').delete()]) {
        const result = await operation.eq('owner_id', ownerA.id).select('id');
        expect(result.error).toBeNull();
        expect(result.data).toEqual([]);
      }
      expect((await anonymous.from('navigation_items').select('id')).error?.code).toBe('42501');
      expect((await anonymous.rpc('replace_navigation_items', { target_locale: 'th', target_location: 'header', menu_items: [] })).error?.code).toBe('42501');
      const home = { kind: 'home', label: 'Home', page_id: null, url: null };
      const custom = { kind: 'custom', label: 'Custom', page_id: null, url: '/contact' };
      const invalidMenus: Json[] = [
        null, {}, Array.from({ length: 51 }, () => home),
        [home, home], [replacement[1], replacement[1]],
        [custom, { ...custom, url: ' /contact ' }],
        [home, { ...custom, label: ' ' }], [home, { ...custom, label: 'x'.repeat(81) }],
        [home, { ...custom, url: '//example.com' }], [home, { ...custom, url: 'javascript:alert(1)' }],
        [home, { ...custom, url: 'https://example.com/has space' }],
        [home, { ...custom, url: '/\\example.com' }],
        [home, { ...custom, page_id: page.id }], [home, { ...home, url: '/' }],
        [home, { kind: 'page', label: 'Wrong locale', page_id: sibling.id, url: null }],
        [home, { kind: 'unknown', label: 'Unknown', page_id: null, url: null }],
      ];
      for (const invalid of invalidMenus) {
        expect((await replace(invalid)).error).not.toBeNull();
        const preserved = await a.from('navigation_items').select().eq('locale', 'th').eq('location', 'header').order('position').order('id');
        expect(preserved.error).toBeNull();
        expect(preserved.data).toEqual(menu.data);
      }
      expect((await b.rpc('replace_navigation_items', { target_locale: 'th', target_location: 'header', menu_items: [replacement[1]] })).error).not.toBeNull();

      const otherMenus: NavigationItemInsert[] = [
        { ...reference, location: 'footer' as const },
        { ...reference, locale: 'en' as const, page_id: sibling.id },
        { owner_id: ownerB.id, locale: 'th' as const, location: 'header' as const, kind: 'home' as const, label: 'Other owner', position: 0 },
      ];
      for (const item of otherMenus) {
        expect((await (item.owner_id === ownerA.id ? a : b).from('navigation_items').insert(item)).error).toBeNull();
      }
      expect((await replace(replacement)).error).toBeNull();
      expect((await a.from('navigation_items').select('id').eq('location', 'footer')).data).toHaveLength(1);
      expect((await a.from('navigation_items').select('id').eq('locale', 'en')).data).toHaveLength(1);
      expect((await b.from('navigation_items').select('id')).data).toHaveLength(1);
      const deleted = await a.from('pages').delete().eq('id', page.id).select('id');
      expect(deleted.error).toBeNull();
      expect(deleted.data).toEqual([{ id: page.id }]);
      expect((await a.from('navigation_items').select('id').eq('page_id', page.id)).data).toEqual([]);
      expect((await a.from('pages').select('id').eq('id', sibling.id)).data).toEqual([{ id: sibling.id }]);
      expect((await a.from('navigation_items').select('id').eq('page_id', sibling.id)).data).toHaveLength(1);
      expect((await a.from('navigation_items').select('id').eq('kind', 'custom')).data).toHaveLength(2);
      const deletedDraft = await a.from('pages').delete().eq('id', sibling.id).select('id');
      expect(deletedDraft.error).toBeNull();
      expect(deletedDraft.data).toEqual([{ id: sibling.id }]);
      expect((await replace([])).data).toEqual([]);
    } finally {
      for (const owner of owners) {
        await admin.from('navigation_items').delete().eq('owner_id', owner.id);
        await admin.from('pages').delete().eq('author_id', owner.id);
        await deleteOwner(owner);
      }
    }
  });
});
