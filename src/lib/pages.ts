
import type { Page, PageLocale, PageStatus } from '../types/cms';
import { editorText } from './editor-content';
import { contentSlug } from './slug';
import { summaryText } from './summary-text';

export const RESERVED_PAGE_SLUGS = new Set(['blog']);

export function resolvePageSlug(value: string | undefined, title: string) {
  return contentSlug(value || title) || `page-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * The line a reader is shown while deciding, where a theme lists or links to the page.
 *
 * Nothing that ships calls this yet -- there is no grid of pages. It is the page's half of
 * the split posts got: what the owner wrote for a reader first, and only then what the page
 * tells a search engine.
 */
export function pageExcerpt(
  page: Pick<Page, 'content_json' | 'excerpt' | 'locale' | 'meta_description'>,
  fallback: string,
) {
  return page.excerpt || pageDescription(page, fallback);
}

/** What the page tells a search engine. The excerpt is deliberately not in this chain. */
export function pageDescription(
  page: Pick<Page, 'content_json' | 'locale' | 'meta_description'>,
  fallback: string,
) {
  if (page.meta_description) return page.meta_description;
  const text = editorText(page.content_json).replace(/\s+/g, ' ').trim();
  return text ? summaryText(text, page.locale) : fallback;
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
