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
      clearSearch: 'ล้างการค้นหา',
      closeImage: 'ปิดภาพ',
      openImage: 'เปิดภาพขนาดเต็ม',
      playVideo: 'เล่นวิดีโอ',
      closeNotice: 'ปิดประกาศ',
      closePopup: 'ปิดหน้าต่างนี้',
      popupDecline: 'ไม่ล่ะ ขอบคุณ',
      defaultTagline: 'รวมทุกความคิดไว้ใน TomeCMS พร้อมให้โลกได้อ่าน',
      draftPreview: 'ตัวอย่างฉบับร่าง',
      footerNavigation: 'ลิงก์ท้ายเว็บ',
      menu: 'เมนู',
      minutesRead: 'อ่าน {minutes} นาที',
      morePosts: 'บทความเพิ่มเติม',
      noPosts: 'ยังไม่มีบทความที่เผยแพร่',
      noPostsInCategory: 'ยังไม่มีบทความในหมวดหมู่นี้',
      noResults: 'ไม่พบบทความที่ตรงกับ “{query}”',
      onThisPage: 'ในหน้านี้',
      opensInNewTab: '(เปิดในแท็บใหม่)',
      poweredBy: 'ขับเคลื่อนด้วย {tomecms}',
      lastSaved: 'บันทึกล่าสุด',
      latestPosts: 'บทความล่าสุด',
      maintenanceBack: 'กลับมาประมาณ {when}',
      maintenanceBar: 'เว็บปิดปรับปรุงอยู่ ผู้เข้าชมจะเห็นหน้าปิดปรับปรุง',
      maintenanceDays: 'วัน',
      maintenanceHours: 'ชั่วโมง',
      maintenanceManage: 'ตั้งค่าปิดปรับปรุง',
      maintenanceMinutes: 'นาที',
      maintenanceSeconds: 'วินาที',
      maintenanceSoon: 'กลับมาในอีกไม่ช้า',
      primaryNavigation: 'เมนูหลัก',
      postsUnavailable: 'ขณะนี้ยังแสดงบทความไม่ได้ โปรดลองใหม่ภายหลัง',
      published: 'เผยแพร่เมื่อ',
      search: 'ค้นหา',
      searchLabel: 'ค้นหาบทความ',
      searchResults: 'ผลการค้นหา “{query}”',
      showMenu: 'แสดงเมนู {label}',
      showing: 'กำลังแสดง {name}',
      startReading: 'เริ่มอ่าน',
      updated: 'แก้ไขเมื่อ',
    }
    : {
      aboutTheAuthor: 'About the author',
      allPosts: 'All posts',
      allRightsReserved: 'All rights reserved.',
      authorLinks: 'Author links',
      by: 'By',
      categories: 'Categories',
      clearSearch: 'Clear search',
      closeImage: 'Close image',
      openImage: 'Open the image full size',
      playVideo: 'Play video',
      closeNotice: 'Close announcement',
      closePopup: 'Close this window',
      popupDecline: 'No thanks',
      defaultTagline: 'Collected in TomeCMS. Ready for the world to see.',
      draftPreview: 'Draft preview',
      footerNavigation: 'Footer',
      menu: 'Menu',
      minutesRead: '{minutes} min read',
      morePosts: 'More posts',
      noPosts: 'No published posts yet.',
      noPostsInCategory: 'No posts in this category yet.',
      noResults: 'No posts match “{query}”.',
      onThisPage: 'On this page',
      opensInNewTab: '(opens in a new tab)',
      poweredBy: 'Powered by {tomecms}',
      lastSaved: 'Last saved',
      latestPosts: 'Latest posts',
      maintenanceBack: 'Back around {when}',
      maintenanceBar: 'The site is closed for maintenance. Visitors see the maintenance page.',
      maintenanceDays: 'days',
      maintenanceHours: 'hours',
      maintenanceManage: 'Maintenance settings',
      maintenanceMinutes: 'minutes',
      maintenanceSeconds: 'seconds',
      maintenanceSoon: 'Back any moment now',
      primaryNavigation: 'Primary',
      postsUnavailable: 'Published posts are temporarily unavailable.',
      published: 'Published',
      search: 'Search',
      searchLabel: 'Search posts',
      searchResults: 'Results for “{query}”',
      showMenu: 'Show the {label} menu',
      showing: 'Showing {name}',
      startReading: 'Start reading',
      updated: 'Updated',
    };
}

/** The credit as plain words, for a theme that does not link the product's name. */
export function poweredByText(copy: Pick<ReturnType<typeof publicCopy>, 'poweredBy'>): string {
  return copy.poweredBy.replace('{tomecms}', 'TomeCMS');
}
