import type { PluginManifest } from '../contract';

/** Kept apart from the hooks so the admin can name the plugin without loading it. */
export const manifest: PluginManifest = {
  description: {
    en: 'A band across the top of every public page, with a sentence you write.',
    th: 'แถบพาดบนสุดของทุกหน้าสาธารณะ พร้อมประโยคที่คุณเขียนเอง',
  },
  hooks: ['publicPage'],
  icon: 'navigation',
  id: 'notice',
  name: 'Sticky Banner',
  settings: [
    {
      key: 'textEn',
      kind: 'text',
      label: { en: 'Message (English)', th: 'ข้อความ (อังกฤษ)' },
      required: false,
    },
    {
      key: 'textTh',
      kind: 'text',
      label: { en: 'Message (Thai)', th: 'ข้อความ (ไทย)' },
      required: false,
    },
    {
      key: 'linkHref',
      kind: 'text',
      label: { en: 'Link', th: 'ลิงก์' },
      hint: {
        en: 'Optional. A path on this site, or an https address; anything else is ignored.',
        th: 'ไม่บังคับ ใส่เป็นพาธในเว็บนี้ หรือที่อยู่ https เท่านั้น นอกนั้นจะถูกละเว้น',
      },
      required: false,
    },
    {
      key: 'linkLabel',
      kind: 'text',
      label: { en: 'Link text', th: 'ข้อความของลิงก์' },
      required: false,
    },
    {
      fallback: 'on',
      hint: {
        en: 'Off keeps the band up for everyone, and the page carries no script for it at all.',
        th: 'ถ้าปิด แถบจะแสดงค้างไว้กับทุกคน และหน้าเว็บจะไม่ต้องโหลดสคริปต์ของแถบเลย',
      },
      key: 'dismissible',
      kind: 'switch',
      label: { en: 'Readers can close it', th: 'ให้ผู้อ่านปิดแถบเองได้' },
      required: false,
    },
    {
      fallback: '#000000',
      key: 'background',
      kind: 'color',
      label: { en: 'Background', th: 'สีพื้นหลัง' },
      required: false,
    },
    {
      fallback: '#ffffff',
      hint: {
        en: 'Pick something that reads against the background: pale on dark, or dark on pale.',
        th: 'เลือกสีที่อ่านออกบนพื้นหลัง — สีอ่อนบนพื้นเข้ม หรือสีเข้มบนพื้นอ่อน',
      },
      key: 'text',
      kind: 'color',
      label: { en: 'Text', th: 'สีตัวอักษร' },
      required: false,
    },
  ],
};
