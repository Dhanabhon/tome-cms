import type { PluginManifest } from '../contract';

export const manifest: PluginManifest = {
  description: {
    en: 'Lets an AI app such as Claude or ChatGPT read your posts and pages and write drafts, after you allow it with your passkey. It cannot publish or delete.',
    th: 'ให้แอป AI อย่าง Claude หรือ ChatGPT อ่านบทความและหน้า และเขียนฉบับร่างได้ หลังจากคุณอนุญาตด้วย passkey เผยแพร่หรือลบอะไรไม่ได้',
  },
  hooks: ['mcp'],
  // There is no plug among the admin's icons; a link is the nearest.
  icon: 'link',
  id: 'mcp',
  name: 'MCP',
  official: true,
  settings: [
    {
      key: 'allowWrite',
      kind: 'switch',
      label: { en: 'Allow AI to write drafts', th: 'อนุญาตให้ AI เขียนฉบับร่าง' },
      hint: { en: 'Off: every connection can only read, at once.', th: 'ปิด: ทุกการเชื่อมต่ออ่านได้อย่างเดียวทันที' },
      required: false,
      fallback: 'on',
    },
    {
      key: 'extraRedirects',
      kind: 'text',
      label: { en: 'More redirect addresses', th: 'ที่อยู่ redirect เพิ่มเติม' },
      hint: {
        en: 'Only for an AI app other than Claude, ChatGPT or Gemini. Comma-separated, https or this computer only.',
        th: 'สำหรับแอป AI อื่นนอกจาก Claude, ChatGPT และ Gemini เท่านั้น คั่นด้วยจุลภาค ใช้ได้เฉพาะ https หรือเครื่องนี้',
      },
      required: false,
    },
  ],
};
