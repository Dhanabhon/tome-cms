import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, PostCategoryBadge, PostCategorySummary } from '../types/cms';

export async function getOwnerCategories(
  supabase: SupabaseClient<Database>,
  ownerId: string,
): Promise<PostCategorySummary[]> {
  const { data: categories, error } = await supabase.from('categories').select('*')
    .eq('owner_id', ownerId).order('is_default', { ascending: false }).order('name').order('id').limit(100);
  if (error) throw error;

  // ponytail: cap one owner's manager read; add pagination when 100 Categories or 2,000 assignments is a real need.
  const counts = new Map<string, Set<string>>();
  if (categories.length) {
    const { data: assignments, error: assignmentError } = await supabase.from('post_category_assignments')
      .select('category_id, translation_group_id').eq('owner_id', ownerId)
      .in('category_id', categories.map(({ id }) => id)).limit(2_000);
    if (assignmentError) throw assignmentError;
    for (const { category_id, translation_group_id } of assignments) {
      const groups = counts.get(category_id) ?? new Set<string>();
      groups.add(translation_group_id);
      counts.set(category_id, groups);
    }
  }

  return categories
    .map((category) => ({ ...category, postCount: counts.get(category.id)?.size ?? 0 }))
    .sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name));
}

export async function getCategoryIdsForPost(
  supabase: SupabaseClient<Database>,
  ownerId: string,
  postId: string,
): Promise<string[] | null> {
  const { data: post, error } = await supabase.from('posts').select('translation_group_id')
    .eq('id', postId).eq('author_id', ownerId).maybeSingle();
  if (error) throw error;
  if (!post) return null;

  const { data: assignments, error: assignmentError } = await supabase.from('post_category_assignments')
    .select('category_id').eq('owner_id', ownerId).eq('translation_group_id', post.translation_group_id)
    .order('category_id');
  if (assignmentError) throw assignmentError;
  return assignments.map(({ category_id }) => category_id);
}

export async function getCategoryBadgesByGroup(
  supabase: SupabaseClient<Database>,
  groupIds: string[],
): Promise<Map<string, PostCategoryBadge[]>> {
  const uniqueGroupIds = [...new Set(groupIds)];
  const badges = new Map(uniqueGroupIds.map((id) => [id, [] as PostCategoryBadge[]]));
  if (!uniqueGroupIds.length) return badges;

  const { data, error } = await supabase.from('post_category_assignments')
    .select('translation_group_id, categories!post_category_assignments_category_id_owner_id_fkey(id, name, is_default)')
    .in('translation_group_id', uniqueGroupIds);
  if (error) throw error;

  const defaults = new Map<string, boolean>();
  for (const { translation_group_id, categories } of data) {
    defaults.set(categories.id, categories.is_default);
    badges.get(translation_group_id)?.push({ id: categories.id, name: categories.name });
  }
  for (const groupBadges of badges.values()) {
    groupBadges.sort((a, b) => Number(defaults.get(b.id)) - Number(defaults.get(a.id)) || a.name.localeCompare(b.name));
  }
  return badges;
}
