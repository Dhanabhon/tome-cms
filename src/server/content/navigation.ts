import type { Selectable, Transaction } from 'kysely';
import { z } from 'zod';

import { localePath, pagePath } from '../../lib/i18n';
import { normalizeNavigationUrl } from '../../lib/navigation-url';
import {
  POST_LOCALES,
  type NavigationItem,
  type Page,
  type PageLocale,
  type PublicNavigationItem,
} from '../../types/cms';
import { db } from '../db/client';
import type { Database, NavigationItemTable } from '../db/types';
import { HttpError } from '../http/errors';

const label = z.string().trim().min(1).max(80);
const customUrl = z.string().trim().transform(normalizeNavigationUrl)
  .pipe(z.string().min(1).max(2_048));
const navigationMutationItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('home'), label, pageId: z.null(), url: z.null() }).strict(),
  z.object({ kind: z.literal('page'), label, pageId: z.uuid().transform((id) => id.toLowerCase()), url: z.null() }).strict(),
  z.object({ kind: z.literal('custom'), label, pageId: z.null(), url: customUrl }).strict(),
]);

export const navigationMenuSchema = z.object({
  locale: z.enum(POST_LOCALES),
  location: z.enum(['header', 'footer']),
  items: z.array(navigationMutationItemSchema).max(50),
}).strict().superRefine(({ items }, context) => {
  const targets = new Set<string>();
  for (const [index, item] of items.entries()) {
    const target = `${item.kind}:${item.kind === 'page' ? item.pageId : item.kind === 'custom' ? item.url : ''}`;
    if (targets.has(target)) context.addIssue({ code: 'custom', message: 'Duplicate navigation target.', path: ['items', index] });
    targets.add(target);
  }
});

export type NavigationMenuMutation = z.infer<typeof navigationMenuSchema>;
export type NavigationPageSummary = Pick<Page, 'id' | 'translation_group_id' | 'locale' | 'title' | 'slug' | 'status'>;

export interface PublicNavigation {
  footer: PublicNavigationItem[];
  header: PublicNavigationItem[];
}

function navigationItem(row: Selectable<NavigationItemTable>): NavigationItem {
  return {
    ...row,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function postgresCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null;
}

async function lockOwner(trx: Transaction<Database>, ownerId: string): Promise<void> {
  const owner = await trx.selectFrom('user').select('id').where('id', '=', ownerId).forUpdate().executeTakeFirst();
  if (!owner) throw new HttpError(404, 'Owner not found.');
}

export async function listNavigation(ownerId: string): Promise<{
  items: NavigationItem[];
  pages: NavigationPageSummary[];
}> {
  const [items, pages] = await Promise.all([
    db.selectFrom('navigation_items').selectAll()
      .where('owner_id', '=', ownerId)
      .orderBy('locale').orderBy('location').orderBy('position').orderBy('id').execute(),
    db.selectFrom('pages').select(['id', 'translation_group_id', 'locale', 'title', 'slug', 'status'])
      .where('owner_id', '=', ownerId).orderBy('title').orderBy('id').execute(),
  ]);
  return { items: items.map(navigationItem), pages };
}

export async function replaceNavigation(ownerId: string, input: NavigationMenuMutation): Promise<NavigationItem[]> {
  try {
    const rows = await db.transaction().execute(async (trx) => {
      await lockOwner(trx, ownerId);
      const pageIds = input.items.flatMap((item) => item.kind === 'page' ? [item.pageId] : []);
      if (pageIds.length) {
        const pages = await trx.selectFrom('pages').select('id')
          .where('owner_id', '=', ownerId)
          .where('locale', '=', input.locale)
          .where('id', 'in', pageIds)
          .forKeyShare()
          .execute();
        if (pages.length !== pageIds.length) throw new HttpError(400, 'Choose Pages from this site and language.');
      }

      await trx.deleteFrom('navigation_items')
        .where('owner_id', '=', ownerId)
        .where('locale', '=', input.locale)
        .where('location', '=', input.location)
        .execute();
      if (!input.items.length) return [];
      return trx.insertInto('navigation_items').values(input.items.map((item, position) => ({
        owner_id: ownerId,
        locale: input.locale,
        location: input.location,
        kind: item.kind,
        label: item.label,
        page_id: item.pageId,
        url: item.url,
        position,
      }))).returningAll().execute();
    });
    invalidatePublicNavigationCache();
    return rows.map(navigationItem);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (['22023', '22P02', '23503', '23514'].includes(postgresCode(error) ?? '')) {
      throw new HttpError(400, 'Invalid navigation menu.');
    }
    if (postgresCode(error) === '23505') throw new HttpError(409, 'That navigation target already exists.');
    throw error;
  }
}

// ponytail: this five-second cache is process-local; replace it only when TomeCMS runs multiple app processes.
const cache = new Map<PageLocale, { expiresAt: number; navigation: PublicNavigation }>();
let cacheGeneration = 0;

export function invalidatePublicNavigationCache(): void {
  cache.clear();
  cacheGeneration++;
}

export async function getPublicNavigation(locale: PageLocale): Promise<PublicNavigation> {
  const cached = cache.get(locale);
  if (cached && cached.expiresAt > Date.now()) return cached.navigation;
  const generation = cacheGeneration;
  const navigation: PublicNavigation = { footer: [], header: [] };

  try {
    const settings = await db.selectFrom('site_settings').select('owner_id').where('id', '=', true).executeTakeFirst();
    if (!settings) return navigation;
    const items = await db.selectFrom('navigation_items').selectAll()
      .where('owner_id', '=', settings.owner_id)
      .where('locale', '=', locale)
      .orderBy('position').orderBy('id').limit(100).execute();
    const pageIds = [...new Set(items.flatMap((item) => item.kind === 'page' && item.page_id ? [item.page_id] : []))];
    const pageUrls = new Map<string, string>();
    if (pageIds.length) {
      const pages = await db.selectFrom('pages').select(['id', 'slug'])
        .where('owner_id', '=', settings.owner_id)
        .where('locale', '=', locale)
        .where('status', '=', 'published')
        .where('id', 'in', pageIds)
        .execute();
      for (const page of pages) pageUrls.set(page.id, pagePath({ locale, slug: page.slug }));
    }

    for (const item of items) {
      const href = item.kind === 'home' ? localePath(locale)
        : item.kind === 'page' ? pageUrls.get(item.page_id ?? '')
          : normalizeNavigationUrl(item.url ?? '');
      if (href && navigation[item.location].length < 50) {
        navigation[item.location].push({ href, kind: item.kind, label: item.label });
      }
    }
    if (generation === cacheGeneration) cache.set(locale, { expiresAt: Date.now() + 5_000, navigation });
    return navigation;
  } catch (error) {
    console.error('Public navigation query failed:', error);
    return { footer: [], header: [] };
  }
}
