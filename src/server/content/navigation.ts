import type { Selectable, Transaction } from 'kysely';
import { z } from 'zod';

import { pagePath } from '../../lib/i18n';
import { normalizeNavigationUrl } from '../../lib/navigation-url';
import {
  POST_LOCALES,
  type NavigationItem,
  type Page,
  type PageLocale,
  type PublicNavigation,
} from '../../types/cms';
import { db } from '../db/client';
import type { Database, NavigationItemTable } from '../db/types';
import { HttpError } from '../http/errors';
import { live } from './live';
import { buildPublicNavigation } from './public-navigation';

const label = z.string().trim().min(1).max(80);
const customUrl = z.string().trim().transform(normalizeNavigationUrl)
  .pipe(z.string().min(1).max(2_048));
/** The site's own home and pages open in place; only a link the owner typed may open a new tab. */
const inPlace = z.literal(false).default(false);
const home = { kind: z.literal('home'), label, pageId: z.null(), url: z.null(), newTab: inPlace };
const page = { kind: z.literal('page'), label, pageId: z.uuid().transform((id) => id.toLowerCase()), url: z.null(), newTab: inPlace };
const custom = { kind: z.literal('custom'), label, pageId: z.null(), url: customUrl, newTab: z.boolean().default(false) };
/** A group is a label with no link; it only opens its sub-items. */
const group = { kind: z.literal('group'), label, pageId: z.null(), url: z.null(), newTab: inPlace };
/** A sub-item is a link and holds no sub-items of its own: one level only. */
const navigationSubItemSchema = z.discriminatedUnion('kind', [
  z.object(home).strict(),
  z.object(page).strict(),
  z.object(custom).strict(),
]);
const children = z.array(navigationSubItemSchema).max(50).optional();
const navigationMutationItemSchema = z.discriminatedUnion('kind', [
  z.object({ ...home, children }).strict(),
  z.object({ ...page, children }).strict(),
  z.object({ ...custom, children }).strict(),
  z.object({ ...group, children }).strict(),
]);

export const navigationMenuSchema = z.object({
  locale: z.enum(POST_LOCALES),
  location: z.enum(['header', 'footer']),
  items: z.array(navigationMutationItemSchema).max(50),
}).strict().superRefine(({ items, location }, context) => {
  const issue = (message: string, path: PropertyKey[]) => context.addIssue({ code: 'custom', message, path });
  const flat = items.flatMap((item, index) => [
    { item, path: ['items', index] },
    ...(item.children ?? []).map((child, childIndex) => ({ item: child, path: ['items', index, 'children', childIndex] })),
  ]);
  if (flat.length > 50) issue('A menu holds at most 50 items, sub-items included.', ['items']);
  for (const [index, item] of items.entries()) {
    if (location === 'footer' && item.kind === 'group') issue('A group belongs in the header menu.', ['items', index]);
    else if (location === 'footer' && item.children?.length) issue('Only the header menu has sub-items.', ['items', index, 'children']);
    else if (item.kind === 'group' && !item.children?.length) issue('A group needs at least one sub-item.', ['items', index, 'children']);
  }
  const targets = new Set<string>();
  for (const { item, path } of flat) {
    if (item.kind === 'group') continue;
    const target = `${item.kind}:${item.kind === 'page' ? item.pageId : item.kind === 'custom' ? item.url : ''}`;
    if (targets.has(target)) issue('Duplicate navigation target.', path);
    targets.add(target);
  }
});

export type NavigationMenuMutation = z.infer<typeof navigationMenuSchema>;
export type NavigationPageSummary = Pick<Page, 'id' | 'translation_group_id' | 'locale' | 'title' | 'slug' | 'status'>;

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
      const pageIds = input.items.flatMap((item) => [item, ...item.children ?? []])
        .flatMap((item) => item.kind === 'page' ? [item.pageId] : []);
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
      // One running order across the menu: a parent, then its sub-items, then the next parent.
      let position = 0;
      const row = (item: NavigationMenuMutation['items'][number], parentId: string | null) => ({
        owner_id: ownerId,
        locale: input.locale,
        location: input.location,
        kind: item.kind,
        label: item.label,
        page_id: item.pageId,
        url: item.url,
        new_tab: item.newTab,
        parent_id: parentId,
        position: position++,
      });
      const inserted: Selectable<NavigationItemTable>[] = [];
      for (const item of input.items) {
        const parent = await trx.insertInto('navigation_items').values(row(item, null)).returningAll().executeTakeFirstOrThrow();
        inserted.push(parent);
        if (item.children?.length) {
          inserted.push(...await trx.insertInto('navigation_items')
            .values(item.children.map((child) => row(child, parent.id))).returningAll().execute());
        }
      }
      return inserted;
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

export interface PublicNavigationSnapshot {
  lastModified: Date;
  navigation: PublicNavigation;
}

// ponytail: this five-second cache is process-local; replace it only when TomeCMS runs multiple app processes.
const cache = new Map<PageLocale, { expiresAt: number; snapshot: PublicNavigationSnapshot }>();
let cacheGeneration = 0;

export function invalidatePublicNavigationCache(): void {
  cache.clear();
  cacheGeneration++;
}

async function queryPublicNavigation(locale: PageLocale): Promise<PublicNavigationSnapshot> {
  const settings = await db.selectFrom('site_settings').select(['owner_id', 'updated_at'])
    .where('id', '=', true).executeTakeFirst();
  if (!settings) return { lastModified: new Date(0), navigation: { footer: [], header: [] } };
  let modified = settings.updated_at.getTime();
  const items = await db.selectFrom('navigation_items').selectAll()
    .where('owner_id', '=', settings.owner_id)
    .where('locale', '=', locale)
    .orderBy('position').orderBy('id').limit(100).execute();
  for (const item of items) modified = Math.max(modified, item.updated_at.getTime());
  const pageIds = [...new Set(items.flatMap((item) => item.kind === 'page' && item.page_id ? [item.page_id] : []))];
  const pageUrls = new Map<string, string>();
  if (pageIds.length) {
    const pages = await db.selectFrom('pages').select(['id', 'slug', 'updated_at'])
      .where('owner_id', '=', settings.owner_id)
      .where('locale', '=', locale)
      .where(live('pages'))
      .where('id', 'in', pageIds)
      .execute();
    for (const page of pages) {
      pageUrls.set(page.id, pagePath({ locale, slug: page.slug }));
      modified = Math.max(modified, page.updated_at.getTime());
    }
  }

  return { lastModified: new Date(modified), navigation: buildPublicNavigation(items, pageUrls, locale) };
}

export async function getPublicNavigationSnapshot(locale: PageLocale): Promise<PublicNavigationSnapshot> {
  const cached = cache.get(locale);
  if (cached && cached.expiresAt > Date.now()) return cached.snapshot;
  const generation = cacheGeneration;
  const snapshot = await queryPublicNavigation(locale);
  if (generation === cacheGeneration) cache.set(locale, { expiresAt: Date.now() + 5_000, snapshot });
  return snapshot;
}

export async function getPublicNavigation(locale: PageLocale): Promise<PublicNavigation> {
  try {
    return (await getPublicNavigationSnapshot(locale)).navigation;
  } catch (error) {
    console.error('Public navigation query failed:', error);
    return { footer: [], header: [] };
  }
}
