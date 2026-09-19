import type { Page, Post, PostLocale } from '../types/cms';
import { POST_LOCALES } from '../types/cms';

export function isPostLocale(value: string | null | undefined): value is PostLocale {
  return POST_LOCALES.some((locale) => locale === value);
}

export const localePath = (locale: PostLocale) => `/${locale}`;
export const postPath = (post: Pick<Post, 'locale' | 'slug'>) => `/${post.locale}/blog/${encodeURIComponent(post.slug)}`;
export const pagePath = (page: Pick<Page, 'locale' | 'slug'>) => `/${page.locale}/${encodeURIComponent(page.slug)}`;
export const otherLocale = (locale: PostLocale): PostLocale => locale === 'th' ? 'en' : 'th';

/** The tag Intl wants for a locale. Here rather than in each component, so a page never
 *  decides for itself what "th" means -- the words and the dates come from one answer. */
export const dateLocale = (locale: PostLocale) => locale === 'th' ? 'th-TH' : 'en';

/**
 * The words the public article surfaces say for themselves -- everything not written by the
 * owner. Declared here rather than in each component because five of them need the same
 * handful, and a Thai reader should not meet "Published" on a Thai page.
 */
export function publicCopy(locale: PostLocale) {
  return locale === 'th'
    ? {
      aboutTheAuthor: 'เกี่ยวกับผู้เขียน',
      allPosts: 'บทความทั้งหมด',
      allRightsReserved: 'สงวนลิขสิทธิ์',
      authorLinks: 'ลิงก์ของผู้เขียน',
      by: 'โดย',
      categories: 'หมวดหมู่',
      draftPreview: 'ตัวอย่างฉบับร่าง',
      footerNavigation: 'ลิงก์ท้ายเว็บ',
      menu: 'เมนู',
      lastSaved: 'บันทึกล่าสุด',
      primaryNavigation: 'เมนูหลัก',
      published: 'เผยแพร่เมื่อ',
      updated: 'แก้ไขเมื่อ',
    }
    : {
      aboutTheAuthor: 'About the author',
      allPosts: 'All posts',
      allRightsReserved: 'All rights reserved.',
      authorLinks: 'Author links',
      by: 'By',
      categories: 'Categories',
      draftPreview: 'Draft preview',
      footerNavigation: 'Footer',
      menu: 'Menu',
      lastSaved: 'Last saved',
      primaryNavigation: 'Primary',
      published: 'Published',
      updated: 'Updated',
    };
}
