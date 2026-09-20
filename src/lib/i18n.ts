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
 * This year, counted the way the reader counts it: 2569 on a Thai page, 2026 on an English
 * one, so a footer never disagrees with the date above it.
 *
 * Only the year part is taken. Asking Intl for a Thai year returns "พ.ศ. 2569", and the era
 * reads badly after a copyright sign -- while a date elsewhere on the page renders its year
 * bare, as "19 กันยายน 2569".
 */
export function currentYear(locale: PostLocale, now = new Date()): string {
  const parts = new Intl.DateTimeFormat(dateLocale(locale), { year: 'numeric' }).formatToParts(now);
  return parts.find((part) => part.type === 'year')?.value ?? String(now.getFullYear());
}

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
      closeImage: 'ปิดรูป',
      closeNotice: 'ปิดประกาศ',
      defaultTagline: 'รวมทุกความคิดไว้ใน TomeCMS พร้อมให้โลกได้อ่าน',
      draftPreview: 'ตัวอย่างฉบับร่าง',
      footerNavigation: 'ลิงก์ท้ายเว็บ',
      menu: 'เมนู',
      poweredBy: 'ขับเคลื่อนด้วย TomeCMS',
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
      closeImage: 'Close image',
      closeNotice: 'Close announcement',
      defaultTagline: 'Collected in TomeCMS. Ready for the world to see.',
      draftPreview: 'Draft preview',
      footerNavigation: 'Footer',
      menu: 'Menu',
      poweredBy: 'Powered by TomeCMS',
      lastSaved: 'Last saved',
      primaryNavigation: 'Primary',
      published: 'Published',
      updated: 'Updated',
    };
}
