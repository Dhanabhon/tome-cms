import { expect, test } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/types/cms';
import { admin, anonKey, createOwner, deleteOwner, supabaseUrl, type TestOwner } from './support';

async function post(owner: TestOwner, translation_group_id?: string, locale = 'th') {
  const result = await owner.client.from('posts').insert({
    author_id: owner.id, title: 'Category contract', slug: `category-${crypto.randomUUID()}`,
    locale, ...(translation_group_id ? { translation_group_id } : {}),
    content_json: { type: 'doc', content: [] }, content_html: '<p>Category contract</p>',
  }).select().single();
  expect(result.error).toBeNull();
  return result.data!;
}

async function membership(client: SupabaseClient, group: string) {
  const result = await client.from('post_category_assignments').select('category_id').eq('translation_group_id', group).order('category_id');
  expect(result.error).toBeNull();
  return result.data!.map((row) => row.category_id as string);
}

test.describe('Post Categories database contracts', () => {
  test.describe.configure({ mode: 'serial' });
  test('enforces shared membership, ownership, publication visibility and atomic mutations', async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Database contracts run once on desktop.');
    const owners: TestOwner[] = [];
    try {
      const a = await createOwner('categories-a'); owners.push(a);
      const b = await createOwner('categories-b'); owners.push(b);
      const anonymous = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const [th, draft] = await Promise.all([post(a), post(a)]);
      const defaults = await a.client.from('categories').select().eq('is_default', true);
      expect(defaults.error).toBeNull();
      expect(defaults.data).toHaveLength(1);
      const fallback = defaults.data![0];
      expect(fallback.name).toBe('Uncategorized');
      expect(await membership(a.client, th.translation_group_id)).toEqual([fallback.id]);
      const en = await post(a, th.translation_group_id, 'en');
      expect(await membership(a.client, en.translation_group_id)).toEqual([fallback.id]);
      const other = await post(b);
      const makeCategory = async (owner: TestOwner, name: string) => {
        const result = await owner.client.from('categories').insert({ owner_id: owner.id, name }).select().single();
        expect(result.error).toBeNull();
        return result.data!;
      };
      const first = await makeCategory(a, 'News');
      const second = await makeCategory(a, 'Research');
      const hidden = await makeCategory(a, 'Draft only');
      const foreign = await makeCategory(b, 'News');
      for (const name of ['', ' ', ' Untrimmed', 'Untrimmed ', 'x'.repeat(81), 'uncategorized', 'UNCATEGORIZED']) {
        expect((await a.client.from('categories').insert({ owner_id: a.id, name })).error?.code, name)
          .toBe(name.toLowerCase() === 'uncategorized' ? '42501' : '23514');
      }
      expect((await makeCategory(a, 'x'.repeat(80))).name).toHaveLength(80);
      expect((await a.client.from('categories').insert({ owner_id: a.id, name: 'nEwS' })).error?.code).toBe('23505');
      expect((await a.client.from('categories').insert({ owner_id: a.id, name: 'Uncategorized', is_default: true })).error?.code).toBe('42501');
      expect((await b.client.from('categories').insert({ owner_id: a.id, name: 'Forged' })).error?.code).toBe('42501');
      const renamed = await a.client.from('categories').update({ name: 'Research updated' }).eq('id', second.id).select().single();
      expect(renamed.error).toBeNull();
      expect(Date.parse(renamed.data!.updated_at)).toBeGreaterThan(Date.parse(second.updated_at));
      expect((await a.client.from('categories').update({ owner_id: b.id }).eq('id', first.id)).error).not.toBeNull();
      for (const patch of [{ name: 'Renamed default' }, { is_default: false }, { name: 'Renamed default', is_default: false }]) {
        expect((await a.client.from('categories').update(patch).eq('id', fallback.id)).error).not.toBeNull();
      }
      expect((await a.client.from('categories').delete().eq('id', fallback.id)).error?.code).toBe('42501');
      expect((await a.client.from('categories').delete().eq('id', first.id)).error?.code).toBe('42501');
      expect((await b.client.from('categories').update({ name: 'Intruder' }).eq('id', first.id).select()).data).toEqual([]);
      expect((await b.client.from('categories').delete().eq('id', first.id)).error?.code).toBe('42501');
      for (const owner of [a, b]) {
        const assignment = { translation_group_id: th.translation_group_id, category_id: first.id, owner_id: a.id };
        expect((await owner.client.from('post_category_assignments').insert(assignment)).error?.code).toBe('42501');
        expect((await owner.client.from('post_category_assignments').update({ category_id: first.id }).eq('translation_group_id', th.translation_group_id)).error?.code).toBe('42501');
        expect((await owner.client.from('post_category_assignments').delete().eq('translation_group_id', th.translation_group_id)).error?.code).toBe('42501');
      }
      const replace = (ids: unknown, id = th.id) => a.client.rpc('replace_post_categories', { requested_category_ids: ids, target_post_id: id });
      const custom = [first.id, second.id].sort();
      const many = await a.client.from('categories').insert(
        Array.from({ length: 21 }, (_, index) => ({ owner_id: a.id, name: `Limit ${index}` })),
      ).select('id');
      expect(many.error).toBeNull();
      const manyIds = many.data!.map(({ id }) => id);
      const result = await replace([fallback.id, ...custom]);
      expect(result.error).toBeNull();
      expect(result.data.map((row: { category_id: string }) => row.category_id).sort()).toEqual(custom);
      expect(await membership(a.client, en.translation_group_id)).toEqual(custom);
      expect((await replace(custom, en.id)).error).toBeNull();
      const nested = await (a.client as SupabaseClient<Database>).from('post_category_assignments')
        .select('category_id, categories!post_category_assignments_category_id_owner_id_fkey(id, name)')
        .eq('translation_group_id', th.translation_group_id);
      expect(nested.error).toBeNull();
      expect(nested.data!.map((row) => row.categories.name).sort()).toEqual(['News', 'Research updated']);
      for (const ids of [[first.id, first.id], null, [null], [first.id, null], ['not-a-uuid'], [foreign.id], [crypto.randomUUID()], manyIds]) {
        expect((await replace(ids)).error, JSON.stringify(ids)).not.toBeNull();
        expect(await membership(a.client, th.translation_group_id)).toEqual(custom);
      }
      expect((await replace(manyIds.slice(0, 20))).error).toBeNull();
      expect(await membership(a.client, th.translation_group_id)).toHaveLength(20);
      expect((await replace(custom)).error).toBeNull();
      expect((await replace([], other.id)).error).not.toBeNull();
      expect((await replace([], crypto.randomUUID())).error).not.toBeNull();
      expect((await b.client.rpc('replace_post_categories', { requested_category_ids: [], target_post_id: th.id })).error).not.toBeNull();
      expect((await b.client.rpc('delete_post_category', { target_category_id: first.id })).error).not.toBeNull();
      expect((await a.client.rpc('delete_post_category', { target_category_id: fallback.id })).error).not.toBeNull();
      expect((await anonymous.rpc('replace_post_categories', { requested_category_ids: [], target_post_id: th.id })).error?.code).toBe('42501');
      expect((await anonymous.rpc('delete_post_category', { target_category_id: first.id })).error?.code).toBe('42501');
      expect((await a.client.rpc('ensure_uncategorized', { target_owner_id: b.id })).error?.code).toBe('42501');
      expect((await replace([hidden.id], draft.id)).error).toBeNull();
      expect((await anonymous.from('categories').select('id').eq('owner_id', a.id)).data).toEqual([]);
      expect(await membership(anonymous, th.translation_group_id)).toEqual([]);
      expect((await a.client.from('posts').update({ status: 'published' }).eq('id', en.id)).error).toBeNull();
      const publishedCategories = await anonymous.from('categories').select('id').eq('owner_id', a.id).order('id');
      expect(publishedCategories.error).toBeNull();
      expect(publishedCategories.data!.map(({ id }) => id)).toEqual(custom);
      expect(await membership(anonymous, th.translation_group_id)).toEqual(custom);
      expect(await membership(anonymous, draft.translation_group_id)).toEqual([]);
      expect((await b.client.from('categories').select('id').eq('owner_id', a.id)).data).toEqual([]);
      expect(await membership(b.client, th.translation_group_id)).toEqual([]);
      expect((await a.client.from('categories').select('id').eq('owner_id', b.id)).data).toEqual([]);
      expect(await membership(a.client, other.translation_group_id)).toEqual([]);
      expect((await replace([])).error).toBeNull();
      expect(await membership(a.client, th.translation_group_id)).toEqual([fallback.id]);
      expect((await replace(custom)).error).toBeNull();
      expect((await replace([first.id], draft.id)).error).toBeNull();
      const deletedFirst = await a.client.rpc('delete_post_category', { target_category_id: first.id });
      expect(deletedFirst).toMatchObject({ error: null, data: 2 });
      expect(await membership(a.client, th.translation_group_id)).toEqual([second.id]);
      expect(await membership(a.client, draft.translation_group_id)).toEqual([fallback.id]);
      expect(await a.client.rpc('delete_post_category', { target_category_id: second.id })).toMatchObject({ error: null, data: 1 });
      expect(await membership(a.client, th.translation_group_id)).toEqual([fallback.id]);
      for (const owner of owners) {
        const posts = await owner.client.from('posts').select('translation_group_id').eq('author_id', owner.id);
        expect(posts.error).toBeNull();
        for (const group of new Set(posts.data!.map((row) => row.translation_group_id))) {
          expect((await membership(owner.client, group)).length).toBeGreaterThan(0);
        }
      }
      // Account cascades must also work without manually removing assignments/defaults.
      await deleteOwner(b);
      owners.pop();
      expect((await admin.from('posts').delete().eq('id', other.id)).error).toBeNull();
    } finally {
      for (const owner of owners) {
        await admin.from('post_category_assignments').delete().eq('owner_id', owner.id);
        await admin.from('posts').delete().eq('author_id', owner.id);
        await admin.from('categories').delete().eq('owner_id', owner.id).eq('is_default', false);
        await deleteOwner(owner);
      }
    }
  });
});
