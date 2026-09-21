import type { PluginManifest } from '../contract';

/** Kept apart from the hooks so the admin can name the plugin without loading it. */
export const manifest: PluginManifest = {
  description: {
    en: 'Reads what you have written and suggests categories, a line for the excerpt and a summary for search. Nothing is applied until you press it.',
    th: 'อ่านสิ่งที่คุณเขียนแล้วเสนอหมวดหมู่ ประโยคสำหรับข้อความย่อ และคำอธิบายสำหรับผลค้นหา ไม่มีอะไรถูกใส่จนกว่าคุณจะกดเอง',
  },
  hooks: ['editorSuggestions'],
  icon: 'pencil',
  id: 'typesafe',
  name: 'TypeSafe',
  settings: [
    {
      key: 'apiKey',
      kind: 'secret',
      label: { en: 'API key', th: 'API key' },
      hint: {
        en: 'From your TypeSafe console. Stored encrypted and never shown again; leave blank to keep the current one. The article\'s text is sent to api.typesafe.ai when you press a suggestion button, and at no other time.',
        th: 'จาก TypeSafe console ของคุณ เก็บแบบเข้ารหัสและจะไม่แสดงอีก เว้นว่างไว้เพื่อใช้ค่าเดิม เนื้อหาบทความจะถูกส่งไปที่ api.typesafe.ai เฉพาะตอนกดปุ่มเสนอเท่านั้น',
      },
      required: true,
    },
  ],
};
