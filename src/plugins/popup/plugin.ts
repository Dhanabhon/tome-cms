import type { PluginManifest } from '../contract';

/** Kept apart from the hooks so the admin can name the plugin without loading it. */
export const manifest: PluginManifest = {
  description: {
    en: 'A box over the page with a picture, a few words and a button, opened after a moment or as the reader leaves.',
    th: 'กล่องที่ขึ้นเหนือหน้า มีรูป ข้อความสั้น ๆ และปุ่ม ขึ้นหลังรอสักครู่หรือตอนผู้อ่านกำลังจะออกจากหน้า',
  },
  hooks: ['publicPage'],
  icon: 'popup',
  id: 'popup',
  name: 'Popup',
  previewHref: '/#popup-preview',
  settings: [
    {
      key: 'image',
      kind: 'image',
      label: { en: 'Picture', th: 'รูปภาพ' },
      hint: {
        en: 'Optional. Beside the words, or above them on a phone.',
        th: 'ไม่บังคับ แสดงข้างข้อความ หรือเหนือข้อความบนมือถือ',
      },
      required: false,
    },
    {
      key: 'headingTh',
      kind: 'text',
      label: { en: 'Heading (Thai)', th: 'หัวข้อ (ไทย)' },
      hint: {
        en: 'A language with no heading shows the other language’s popup instead.',
        th: 'ภาษาที่ไม่มีหัวข้อจะแสดง popup ของอีกภาษาแทน',
      },
      required: false,
    },
    { key: 'textTh', kind: 'text', label: { en: 'Message (Thai)', th: 'ข้อความ (ไทย)' }, required: false },
    { key: 'actionTh', kind: 'text', label: { en: 'Button text (Thai)', th: 'ข้อความบนปุ่ม (ไทย)' }, required: false },
    {
      key: 'declineTh',
      kind: 'text',
      label: { en: 'Decline (Thai)', th: 'คำปฏิเสธ (ไทย)' },
      hint: { en: 'Left empty: “ไม่ล่ะ ขอบคุณ”.', th: 'ถ้าเว้นว่างจะใช้ “ไม่ล่ะ ขอบคุณ”' },
      required: false,
    },
    { key: 'finePrintTh', kind: 'text', label: { en: 'Small print (Thai)', th: 'หมายเหตุตัวเล็ก (ไทย)' }, required: false },
    { key: 'headingEn', kind: 'text', label: { en: 'Heading (English)', th: 'หัวข้อ (อังกฤษ)' }, required: false },
    { key: 'textEn', kind: 'text', label: { en: 'Message (English)', th: 'ข้อความ (อังกฤษ)' }, required: false },
    { key: 'actionEn', kind: 'text', label: { en: 'Button text (English)', th: 'ข้อความบนปุ่ม (อังกฤษ)' }, required: false },
    {
      key: 'declineEn',
      kind: 'text',
      label: { en: 'Decline (English)', th: 'คำปฏิเสธ (อังกฤษ)' },
      hint: { en: 'Left empty: “No thanks”.', th: 'ถ้าเว้นว่างจะใช้ “No thanks”' },
      required: false,
    },
    { key: 'finePrintEn', kind: 'text', label: { en: 'Small print (English)', th: 'หมายเหตุตัวเล็ก (อังกฤษ)' }, required: false },
    {
      key: 'actionHref',
      kind: 'text',
      label: { en: 'Button link', th: 'ลิงก์ของปุ่ม' },
      hint: {
        en: 'A path on this site, or an https address; anything else is ignored.',
        th: 'ใส่เป็นพาธในเว็บนี้ หรือที่อยู่ https เท่านั้น นอกนั้นจะถูกละเว้น',
      },
      required: true,
    },
    {
      fallback: 'delay',
      key: 'trigger',
      kind: 'choice',
      label: { en: 'Opens', th: 'ขึ้นเมื่อ' },
      hint: {
        en: 'Leaving is a pointer heading out through the top of the window or, on a phone, reading past half the page.',
        th: 'การจะออกจากหน้าคือเมาส์เลื่อนออกทางขอบบนของหน้าต่าง หรือบนมือถือคือเลื่อนอ่านเกินครึ่งหน้า',
      },
      options: [
        { label: { en: 'After a moment', th: 'หลังรอสักครู่' }, value: 'delay' },
        { label: { en: 'As the reader leaves', th: 'ตอนผู้อ่านจะออกจากหน้า' }, value: 'exit' },
      ],
      required: false,
    },
    {
      fallback: '10',
      key: 'delay',
      kind: 'choice',
      label: { en: 'After', th: 'รอ' },
      options: [
        { label: { en: '5 seconds', th: '5 วินาที' }, value: '5' },
        { label: { en: '10 seconds', th: '10 วินาที' }, value: '10' },
        { label: { en: '20 seconds', th: '20 วินาที' }, value: '20' },
      ],
      required: false,
    },
    {
      fallback: 'all',
      key: 'pages',
      kind: 'choice',
      label: { en: 'Pages', th: 'หน้าที่ขึ้น' },
      options: [
        { label: { en: 'Every page', th: 'ทุกหน้า' }, value: 'all' },
        { label: { en: 'The home page only', th: 'หน้าแรกเท่านั้น' }, value: 'home' },
      ],
      required: false,
    },
  ],
};
