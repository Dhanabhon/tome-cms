import type { Post, PostLocale } from '../types/cms';
import { POST_LOCALES } from '../types/cms';

export function isPostLocale(value: string | null | undefined): value is PostLocale {
  return POST_LOCALES.some((locale) => locale === value);
}

export const localePath = (locale: PostLocale) => `/${locale}`;
export const postPath = (post: Pick<Post, 'locale' | 'slug'>) => `/${post.locale}/blog/${encodeURIComponent(post.slug)}`;
export const otherLocale = (locale: PostLocale): PostLocale => locale === 'th' ? 'en' : 'th';
