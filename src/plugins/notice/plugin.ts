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
  ],
};
