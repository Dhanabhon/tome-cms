import type { ThemeManifest } from '../contract';

/**
 * Kept apart from the templates so the admin can name the theme without loading it.
 *
 * Every text falls back to '' rather than to a sentence: the default is in the page's own
 * language, which a manifest cannot know, so the templates supply it.
 */
export const manifest: ThemeManifest = {
  description: 'Warm paper, serif headings and soft tinted panels, with a hero above a grid of cards.',
  id: 'almanac',
  name: 'Almanac',
  // Trirong at the weight of its titles, and IBM Plex Sans Thai for the body.
  preloadFonts: [
    '/fonts/trirong-latin-600-normal.woff2',
    '/fonts/trirong-thai-600-normal.woff2',
    '/fonts/ibm-plex-sans-thai-latin-400-normal.woff2',
    '/fonts/ibm-plex-sans-thai-thai-400-normal.woff2',
  ],
  settings: [
    {
      fallback: 'on',
      hint: {
        en: 'The band above the posts: a headline, a line under it and two buttons. It is shown on the first page only, and not while a reader is searching.',
        th: 'แถบด้านบนเหนือรายการบทความ มีหัวข้อ คำโปรย และปุ่มสองปุ่ม แสดงเฉพาะหน้าแรก และจะไม่แสดงระหว่างที่ผู้อ่านกำลังค้นหา',
      },
      key: 'hero',
      kind: 'switch',
      label: { en: 'Hero', th: 'แถบหัวเรื่อง' },
    },
    {
      fallback: '',
      hint: {
        en: 'Left blank, the hero shows the site name.',
        th: 'ถ้าเว้นว่าง จะแสดงชื่อเว็บไซต์',
      },
      key: 'heroHeadline',
      kind: 'text',
      label: { en: 'Headline', th: 'หัวข้อ' },
      max: 120,
    },
    {
      fallback: '',
      hint: {
        en: 'The line under the headline. Left blank, it shows the tagline.',
        th: 'ข้อความใต้หัวข้อ ถ้าเว้นว่าง จะแสดงข้อความประจำเว็บไซต์',
      },
      key: 'heroLead',
      kind: 'text',
      label: { en: 'Lead', th: 'คำโปรย' },
      max: 240,
    },
    {
      fallback: '',
      hint: {
        en: 'The filled button. Left blank, it reads “Start reading” in the language the page is read in.',
        th: 'ปุ่มแบบทึบ ถ้าเว้นว่าง จะแสดงคำว่า “เริ่มอ่าน” ตามภาษาของหน้านั้น',
      },
      key: 'primaryLabel',
      kind: 'text',
      label: { en: 'First button', th: 'ปุ่มแรก' },
      max: 40,
    },
    {
      fallback: '',
      hint: {
        en: 'A path on this site starting with /, or an address starting with https://. Left blank, it goes to the newest post.',
        th: 'พาธในเว็บนี้ที่ขึ้นต้นด้วย / หรือที่อยู่ที่ขึ้นต้นด้วย https:// ถ้าเว้นว่าง จะไปที่บทความล่าสุด',
      },
      key: 'primaryLink',
      kind: 'text',
      label: { en: 'First button’s link', th: 'ลิงก์ของปุ่มแรก' },
      max: 2048,
    },
    {
      fallback: '',
      hint: {
        en: 'The outlined button. Left blank, it reads “All posts” in the language the page is read in.',
        th: 'ปุ่มแบบมีเส้นขอบ ถ้าเว้นว่าง จะแสดงคำว่า “บทความทั้งหมด” ตามภาษาของหน้านั้น',
      },
      key: 'secondaryLabel',
      kind: 'text',
      label: { en: 'Second button', th: 'ปุ่มที่สอง' },
      max: 40,
    },
    {
      fallback: '',
      hint: {
        en: 'A path on this site starting with /, or an address starting with https://. Left blank, it goes to the list of posts.',
        th: 'พาธในเว็บนี้ที่ขึ้นต้นด้วย / หรือที่อยู่ที่ขึ้นต้นด้วย https:// ถ้าเว้นว่าง จะไปที่รายการบทความ',
      },
      key: 'secondaryLink',
      kind: 'text',
      label: { en: 'Second button’s link', th: 'ลิงก์ของปุ่มที่สอง' },
      max: 2048,
    },
    {
      fallback: 'on',
      hint: {
        en: 'A thin bar across the top of a post, filling as the reader goes down it. The browser draws it from the scroll position, so the page carries no script for it. A browser that cannot do that shows no bar, and neither does a reader who asked for less motion.',
        th: 'แถบบาง ๆ พาดบนสุดของบทความ เติมขึ้นตามที่ผู้อ่านเลื่อนลง เบราว์เซอร์คำนวณจากตำแหน่งที่เลื่อนอยู่เอง หน้าเว็บจึงไม่ต้องมีสคริปต์ เบราว์เซอร์ที่ทำไม่ได้จะไม่แสดงแถบนี้ และผู้อ่านที่ขอการเคลื่อนไหวน้อยลงก็จะไม่เห็นแถบนี้เช่นกัน',
      },
      key: 'readingProgress',
      kind: 'switch',
      label: { en: 'Reading progress', th: 'แถบความคืบหน้าการอ่าน' },
    },
  ],
};
