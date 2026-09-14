import type { PostLocale } from '../types/cms';

/**
 * Copy for the admin surfaces.
 *
 * The installer already speaks Thai and English, but everything behind it was
 * English-only — a Thai owner was greeted in Thai during setup and then handed
 * an English dashboard. The admin follows `site_settings.default_locale`, the
 * same choice the owner makes during installation.
 *
 * `th` is declared as `typeof en`, so a missing key fails the type check rather
 * than silently shipping an untranslated string.
 */
const en = {
  nav: {
    label: 'Admin',
    media: 'File Manager',
    navigation: 'Navigation',
    pages: 'Pages',
    posts: 'Posts',
    profile: 'Profile',
    settings: 'Settings',
    system: 'System',
  },
  shell: {
    close: 'Close',
    closeNavigation: 'Close navigation',
    menu: 'Menu',
    navigationLabel: 'Admin navigation',
    openNavigation: 'Open navigation',
    signOut: 'Sign out',
    signOutConfirm: 'You will need to sign in again to access the admin area.',
    signOutFailed: 'Unable to sign out. Please try again.',
    signOutTitle: 'Sign out?',
    viewSite: 'View site',
    viewSiteLabel: 'View site (opens in a new tab)',
    cancel: 'Cancel',
  },
  filters: {
    allLanguages: 'All languages',
    apply: 'Apply filters',
    english: 'English',
    language: 'Language',
    searchByTitle: 'Search by title',
    thai: 'Thai',
  },
  status: {
    all: 'All',
    draft: 'draft',
    drafts: 'Drafts',
    published: 'Published',
    publishedAt: 'Published',
    updatedAt: 'Updated',
  },
  row: {
    delete: 'Delete',
    deletePrefix: 'Delete',
    edit: 'Edit',
    minRead: 'min read',
    missing: 'missing',
    preview: 'Preview',
    publish: 'Publish',
    unpublish: 'Unpublish',
  },
  posts: {
    actionsFor: 'Actions for',
    createFirst: 'Create first post',
    deleteMessage: 'Only this language edition will be deleted. This cannot be undone.',
    deleteTitle: 'Delete post?',
    emptyBody: 'Create a draft now and publish whenever it is ready.',
    emptyTitle: 'Your first post starts here',
    heading: 'Posts',
    manageCategories: 'Manage categories',
    newPost: 'New post',
    noMatchBody: 'Try another title, language, or status.',
    noMatchTitle: 'No posts match these filters.',
    search: 'Search posts',
    statusLabel: 'Post status',
    subheading: 'Draft, publish, and keep your writing in one place.',
    untitled: 'Untitled post',
  },
  pages: {
    actionsFor: 'Actions for',
    createFirst: 'Create first page',
    deleteMessage: 'This edition and its menu references will be permanently removed. Other language editions will stay saved. This cannot be undone.',
    deleteTitle: 'Delete page?',
    emptyBody: 'Create a draft now and publish whenever it is ready.',
    emptyTitle: 'Your first page starts here',
    heading: 'Pages',
    newPage: 'New page',
    noMatchBody: 'Try another title, language, or status.',
    noMatchTitle: 'No pages match these filters.',
    search: 'Search pages',
    statusLabel: 'Page status',
    subheading: 'Manage your site pages and their language editions.',
    unpublishMessage: 'Menu placements stay saved but disappear publicly until republished.',
    unpublishTitle: 'Unpublish page?',
    untitled: 'Untitled page',
  },
  errors: {
    actionFailed: 'The action could not be completed. Please try again.',
    dashboardHidden: 'The dashboard is unavailable.',
    pagesHidden: 'The Pages dashboard is unavailable.',
    pagesUnavailable: 'The Pages dashboard is temporarily unavailable.',
    dashboardUnavailable: 'The dashboard is temporarily unavailable.',
  },
};

const th: typeof en = {
  nav: {
    label: 'ผู้ดูแล',
    media: 'คลังไฟล์',
    navigation: 'เมนู',
    pages: 'หน้า',
    posts: 'บทความ',
    profile: 'โปรไฟล์',
    settings: 'ตั้งค่า',
    system: 'ระบบ',
  },
  shell: {
    close: 'ปิด',
    closeNavigation: 'ปิดเมนูนำทาง',
    menu: 'เมนู',
    navigationLabel: 'เมนูผู้ดูแล',
    openNavigation: 'เปิดเมนูนำทาง',
    signOut: 'ออกจากระบบ',
    signOutConfirm: 'คุณจะต้องเข้าสู่ระบบใหม่เพื่อกลับเข้าหน้าผู้ดูแล',
    signOutFailed: 'ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง',
    signOutTitle: 'ออกจากระบบ?',
    viewSite: 'ดูเว็บไซต์',
    viewSiteLabel: 'ดูเว็บไซต์ (เปิดในแท็บใหม่)',
    cancel: 'ยกเลิก',
  },
  filters: {
    allLanguages: 'ทุกภาษา',
    apply: 'กรองข้อมูล',
    english: 'อังกฤษ',
    language: 'ภาษา',
    searchByTitle: 'ค้นหาจากชื่อเรื่อง',
    thai: 'ไทย',
  },
  status: {
    all: 'ทั้งหมด',
    draft: 'ฉบับร่าง',
    drafts: 'ฉบับร่าง',
    published: 'เผยแพร่แล้ว',
    publishedAt: 'เผยแพร่เมื่อ',
    updatedAt: 'แก้ไขเมื่อ',
  },
  row: {
    delete: 'ลบ',
    deletePrefix: 'ลบ',
    edit: 'แก้ไข',
    minRead: 'นาที',
    missing: 'ยังไม่มี',
    preview: 'ดูตัวอย่าง',
    publish: 'เผยแพร่',
    unpublish: 'ยกเลิกเผยแพร่',
  },
  posts: {
    actionsFor: 'การจัดการของ',
    createFirst: 'สร้างบทความแรก',
    deleteMessage: 'จะลบเฉพาะฉบับภาษานี้เท่านั้น และไม่สามารถย้อนกลับได้',
    deleteTitle: 'ลบบทความ?',
    emptyBody: 'สร้างฉบับร่างไว้ก่อน แล้วค่อยเผยแพร่เมื่อพร้อม',
    emptyTitle: 'เริ่มบทความแรกของคุณที่นี่',
    heading: 'บทความ',
    manageCategories: 'จัดการหมวดหมู่',
    newPost: 'บทความใหม่',
    noMatchBody: 'ลองเปลี่ยนชื่อเรื่อง ภาษา หรือสถานะ',
    noMatchTitle: 'ไม่พบบทความที่ตรงกับตัวกรองนี้',
    search: 'ค้นหาบทความ',
    statusLabel: 'สถานะบทความ',
    subheading: 'ร่าง เผยแพร่ และเก็บงานเขียนไว้ที่เดียว',
    untitled: 'บทความไม่มีชื่อ',
  },
  pages: {
    actionsFor: 'การจัดการของ',
    createFirst: 'สร้างหน้าแรก',
    deleteMessage: 'ฉบับภาษานี้และการอ้างอิงในเมนูจะถูกลบถาวร ฉบับภาษาอื่นยังอยู่ครบ และไม่สามารถย้อนกลับได้',
    deleteTitle: 'ลบหน้านี้?',
    emptyBody: 'สร้างฉบับร่างไว้ก่อน แล้วค่อยเผยแพร่เมื่อพร้อม',
    emptyTitle: 'เริ่มหน้าแรกของคุณที่นี่',
    heading: 'หน้า',
    newPage: 'หน้าใหม่',
    noMatchBody: 'ลองเปลี่ยนชื่อเรื่อง ภาษา หรือสถานะ',
    noMatchTitle: 'ไม่พบหน้าที่ตรงกับตัวกรองนี้',
    search: 'ค้นหาหน้า',
    statusLabel: 'สถานะหน้า',
    subheading: 'จัดการหน้าเว็บและฉบับภาษาต่าง ๆ',
    unpublishMessage: 'ตำแหน่งในเมนูจะยังถูกเก็บไว้ แต่จะหายไปจากหน้าเว็บจนกว่าจะเผยแพร่อีกครั้ง',
    unpublishTitle: 'ยกเลิกเผยแพร่หน้านี้?',
    untitled: 'หน้าไม่มีชื่อ',
  },
  errors: {
    actionFailed: 'ทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง',
    dashboardHidden: 'หน้าผู้ดูแลไม่พร้อมใช้งาน',
    pagesHidden: 'หน้าจัดการเพจไม่พร้อมใช้งาน',
    pagesUnavailable: 'หน้าจัดการเพจไม่พร้อมใช้งานชั่วคราว',
    dashboardUnavailable: 'หน้าผู้ดูแลไม่พร้อมใช้งานชั่วคราว',
  },
};

export type AdminCopy = typeof en;

/** The stored status is an English enum; the badge must show the owner's language. */
export function statusLabel(copy: AdminCopy, status: string): string {
  return status === 'published' ? copy.status.published : copy.status.draft;
}

export function adminCopy(locale: PostLocale | null | undefined): AdminCopy {
  return locale === 'th' ? th : en;
}

/** Dates in the admin follow the owner's language, not a hardcoded 'en'. */
export function adminDateFormat(locale: PostLocale | null | undefined, timeZone: string) {
  return new Intl.DateTimeFormat(locale === 'th' ? 'th-TH' : 'en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  });
}
