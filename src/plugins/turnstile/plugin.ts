import type { PluginManifest } from '../contract';

/** Kept apart from the hooks so the admin can name the plugin without loading it. */
export const manifest: PluginManifest = {
  description: {
    en: 'Puts a Cloudflare Turnstile challenge in front of the admin sign-in.',
    th: 'วางแบบทดสอบ Cloudflare Turnstile ไว้หน้าการเข้าสู่ระบบของผู้ดูแล',
  },
  brand: 'cloudflare',
  hooks: ['signIn'],
  icon: 'security',
  id: 'turnstile',
  name: 'Cloudflare Turnstile',
  settings: [
    {
      key: 'siteKey',
      kind: 'text',
      label: { en: 'Site key', th: 'Site key' },
      hint: {
        en: 'From the Turnstile widget in your Cloudflare dashboard. It is public.',
        th: 'จากหน้า Turnstile ใน Cloudflare ของคุณ ค่านี้เป็นข้อมูลสาธารณะ',
      },
      required: true,
    },
    {
      key: 'secretKey',
      kind: 'secret',
      label: { en: 'Secret key', th: 'Secret key' },
      hint: {
        en: 'Stored encrypted and never shown again. Leave blank to keep the current one.',
        th: 'เก็บแบบเข้ารหัสและจะไม่แสดงอีก เว้นว่างไว้เพื่อใช้ค่าเดิมต่อ',
      },
      required: true,
    },
  ],
};
