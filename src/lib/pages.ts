import slugify from 'slugify';

import type { Page, PageLocale, PageStatus } from '../types/cms';
import { editorText } from './editor-content';

export const RESERVED_PAGE_SLUGS = new Set(['blog']);

export function resolvePageSlug(value: string | undefined, title: string) {
  const normalized = slugify(value || title, { lower: true, strict: true, trim: true });
  const slug = value ? normalized : normalized.slice(0, 160).replace(/-+$/, '');
  return slug || `page-${crypto.randomUUID().slice(0, 8)}`;
}

export function pageDescription(
  page: Pick<Page, 'content_json' | 'meta_description'>,
  fallback: string,
) {
  if (page.meta_description) return page.meta_description;
  const text = editorText(page.content_json).replace(/\s+/g, ' ').trim();
  return text ? (text.length > 160 ? `${text.slice(0, 157).trimEnd()}…` : text) : fallback;
}

export interface AdminPageFilters {
  locale: 'all' | PageLocale;
  query: string;
  status: 'all' | PageStatus;
}

export function filterAdminPages(pages: Page[], filters: AdminPageFilters) {
  const query = filters.query.trim().toLocaleLowerCase();
  // ponytail: filter one owner's complete list in memory; add DB pagination only when measured volume requires it.
  return pages.filter((page) => (
    (filters.status === 'all' || page.status === filters.status)
    && (filters.locale === 'all' || page.locale === filters.locale)
    && (!query || page.title.toLocaleLowerCase().includes(query))
  ));
}
