import type { APIRoute } from 'astro';
import { z } from 'zod';

import { invalidatePublicNavigationCache } from '../../../lib/navigation';
import { normalizeNavigationUrl } from '../../../lib/navigation-url';
import { authenticate } from '../../../lib/supabase';
import { POST_LOCALES, type NavigationItem } from '../../../types/cms';

const label = z.string().trim().min(1).max(80);
const customUrl = z.string().trim().max(2048).transform(normalizeNavigationUrl)
  .pipe(z.string().min(1).max(2048));
const itemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('home'), label, pageId: z.null(), url: z.null() }).strict(),
  z.object({ kind: z.literal('page'), label, pageId: z.uuid().transform((id) => id.toLowerCase()), url: z.null() }).strict(),
  z.object({ kind: z.literal('custom'), label, pageId: z.null(), url: customUrl }).strict(),
]);
const menuSchema = z.object({
  locale: z.enum(POST_LOCALES), location: z.enum(['header', 'footer']), items: z.array(itemSchema).max(50),
}).strict().superRefine(({ items }, context) => {
  const targets = new Set<string>();
  for (const [index, item] of items.entries()) {
    const target = `${item.kind}:${item.kind === 'page' ? item.pageId : item.kind === 'custom' ? item.url : ''}`;
    if (targets.has(target)) context.addIssue({ code: 'custom', message: 'Duplicate navigation target.', path: ['items', index] });
    targets.add(target);
  }
});

const itemColumns = 'id, locale, location, kind, label, page_id, url, position, created_at, updated_at';

function safeItem(item: NavigationItem) {
  return {
    id: item.id, locale: item.locale, location: item.location, kind: item.kind,
    label: item.label, page_id: item.page_id, url: item.url, position: item.position,
    created_at: item.created_at, updated_at: item.updated_at,
  };
}

function invalidPayload() {
  return Response.json({ error: 'Invalid navigation payload.' }, { status: 400 });
}

function unexpectedError(error: unknown) {
  console.error('Navigation request failed:', error);
  return Response.json({ error: 'Navigation could not be loaded or saved.' }, { status: 500 });
}

export const GET: APIRoute = async ({ cookies, request }) => {
  try {
    const auth = await authenticate(cookies, request);
    if (!auth) return Response.json({ error: 'Authentication required.' }, { status: 401 });
    const [items, pages] = await Promise.all([
      auth.supabase.from('navigation_items').select(itemColumns).eq('owner_id', auth.user.id)
        .order('locale').order('location').order('position').order('id'),
      auth.supabase.from('pages').select('id, translation_group_id, locale, title, slug, status')
        .eq('author_id', auth.user.id).order('title').order('id'),
    ]);
    if (items.error) return unexpectedError(items.error);
    if (pages.error) return unexpectedError(pages.error);
    return Response.json({ items: items.data, pages: pages.data });
  } catch (error) {
    return unexpectedError(error);
  }
};

export const PUT: APIRoute = async ({ cookies, request }) => {
  try {
    const auth = await authenticate(cookies, request);
    if (!auth) return Response.json({ error: 'Authentication required.' }, { status: 401 });
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return invalidPayload();
    }
    const parsed = menuSchema.safeParse(body);
    if (!parsed.success) return invalidPayload();
    const { locale, location, items } = parsed.data;
    const pageIds = items.flatMap((item) => item.kind === 'page' ? [item.pageId] : []);
    if (pageIds.length) {
      const { data, error } = await auth.supabase.from('pages').select('id')
        .eq('author_id', auth.user.id).eq('locale', locale).in('id', pageIds);
      if (error) return unexpectedError(error);
      if (data.length !== pageIds.length) return invalidPayload();
    }
    const { data, error } = await auth.supabase.rpc('replace_navigation_items', {
      target_locale: locale, target_location: location,
      menu_items: items.map((item) => ({ kind: item.kind, label: item.label, page_id: item.pageId, url: item.url })),
    });
    if (error) {
      if (error.code === '42501') return Response.json({ error: 'Authentication required.' }, { status: 401 });
      if (['22023', '22P02', '23503', '23505', '23514'].includes(error.code)) return invalidPayload();
      return unexpectedError(error);
    }
    invalidatePublicNavigationCache();
    return Response.json({ items: data.map(safeItem) });
  } catch (error) {
    return unexpectedError(error);
  }
};
